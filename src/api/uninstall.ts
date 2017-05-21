import rimraf = require('rimraf-then')
import path = require('path')
import getContext, {PnpmContext} from './getContext'
import getSaveType from '../getSaveType'
import removeDeps from '../removeDeps'
import extendOptions from './extendOptions'
import {PnpmOptions, StrictPnpmOptions, Package} from '../types'
import lock from './lock'
import {
  Shrinkwrap,
  save as saveShrinkwrap,
  prune as pruneShrinkwrap,
} from '../fs/shrinkwrap'
import {
  save as saveModules
} from '../fs/modulesController'
import removeOrphanPkgs from './removeOrphanPkgs'
import {PackageSpec} from '../resolve'
import pnpmPkgJson from '../pnpmPkgJson'
import safeIsInnerLink from '../safeIsInnerLink'
import removeTopDependency from '../removeTopDependency'

export default async function uninstallCmd (pkgsToUninstall: string[], maybeOpts?: PnpmOptions) {
  const opts = extendOptions(maybeOpts)

  const ctx = await getContext(opts)

  if (!ctx.pkg) {
    throw new Error('No package.json found - cannot uninstall')
  }

  const pkg = ctx.pkg

  if (opts.lock === false) {
    return run()
  }

  return lock(ctx.storePath, run, {stale: opts.lockStaleDuration})

  function run () {
    return uninstallInContext(pkgsToUninstall, pkg, ctx, opts)
  }
}

export async function uninstallInContext (pkgsToUninstall: string[], pkg: Package, ctx: PnpmContext, opts: StrictPnpmOptions) {
  const saveType = getSaveType(opts)
  if (saveType) {
    const pkgJsonPath = path.join(ctx.root, 'package.json')
    const pkg = await removeDeps(pkgJsonPath, pkgsToUninstall, saveType)
    for (let depName in ctx.shrinkwrap.packages['/'].dependencies) {
      if (!isDependentOn(pkg, depName)) {
        delete ctx.shrinkwrap.packages['/'].dependencies[depName]
        delete ctx.shrinkwrap.specifiers[depName]
      }
    }
    const newShr = await pruneShrinkwrap(ctx.shrinkwrap)
    const removedPkgIds = await removeOrphanPkgs(ctx.privateShrinkwrap, newShr, ctx.root, ctx.storePath)
    await saveShrinkwrap(ctx.root, newShr)
    await saveModules(path.join(ctx.root, 'node_modules'), {
      packageManager: `${pnpmPkgJson.name}@${pnpmPkgJson.version}`,
      storePath: ctx.storePath,
      skipped: Array.from(ctx.skipped).filter(pkgId => removedPkgIds.indexOf(pkgId) === -1),
    })
    await removeOuterLinks(pkgsToUninstall, path.join(ctx.root, 'node_modules'))
  }
}

function isDependentOn (pkg: Package, depName: string): boolean {
  return [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]
  .some(deptype => pkg[deptype] && pkg[deptype][depName])
}

async function removeOuterLinks (pkgsToUninstall: string[], modules: string) {
  for (const pkgToUninstall of pkgsToUninstall) {
    if (!await safeIsInnerLink(modules, pkgToUninstall)) {
      await removeTopDependency(pkgToUninstall, modules)
    }
  }
}
