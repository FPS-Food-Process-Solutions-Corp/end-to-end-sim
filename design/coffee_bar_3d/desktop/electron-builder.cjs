// Credentials are optional for internal builds. CI enables notarization only
// when all signing secrets are supplied; no binaries are published automatically.
const notarize = !!(process.env.CSC_LINK && process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
const macCertificate = !!(process.env.CSC_LINK || process.env.CSC_NAME);

module.exports = {
  appId:'com.fps.layoutstudio', productName:'Layout Studio',
  directories:{output:'dist'},
  files:['main.cjs', 'protocol.cjs', 'studio/**/*', 'package.json'],
  asar:true, npmRebuild:false,
  beforePack:async () => require('./scripts/prepare-studio.cjs').prepareStudio(),
  artifactName:'Layout-Studio-${version}-${os}-${arch}.${ext}',
  publish:null,
  win:{target:['nsis','zip'],
    artifactName:'Layout-Studio-${version}-win-${arch}.${ext}'},
  nsis:{oneClick:false, perMachine:false, allowToChangeInstallationDirectory:true,
    createDesktopShortcut:true, deleteAppDataOnUninstall:false,
    artifactName:'Layout-Studio-${version}-win-${arch}-Setup.${ext}'},
  mac:{target:['dmg','zip'],
    category:'public.app-category.productivity', hardenedRuntime:macCertificate,
    identity:macCertificate ? undefined : '-',
    entitlements:'entitlements.mac.plist', entitlementsInherit:'entitlements.mac.plist',
    notarize},
  dmg:{sign:false},
};
