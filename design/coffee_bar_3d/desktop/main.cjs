const {app, BrowserWindow, Menu, dialog, net, protocol, session, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {SCHEME, ORIGIN, contentSecurityPolicy, createAssetHandler} = require('./protocol.cjs');

app.setName('Layout Studio');
// A stable profile/origin keeps autosave and named snapshots across app upgrades.
// Tests get a separate temporary profile and never touch a person's saved scenes.
const testMode = process.env.LAYOUT_STUDIO_TEST === '1';
const profile = testMode && process.env.LAYOUT_STUDIO_TEST_PROFILE
  ? path.resolve(process.env.LAYOUT_STUDIO_TEST_PROFILE)
  : path.join(app.getPath('appData'), 'Layout Studio');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
protocol.registerSchemesAsPrivileged([{scheme:SCHEME, privileges:{
  standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, stream:true,
}}]);

let mainWindow;
const root = path.join(__dirname, 'studio');
const entry = `${ORIGIN}/viewer.html`;

function createWindow() {
  mainWindow = new BrowserWindow({
    title:'Layout Studio', width:1600, height:1000, minWidth:1000, minHeight:650,
    backgroundColor:'#222e37', show:!testMode,
    webPreferences:{
      partition:'persist:layout-studio', nodeIntegration:false,
      contextIsolation:true, sandbox:true, webSecurity:true,
      backgroundThrottling:false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('?')[0].split('#')[0] !== entry) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('closed', () => {mainWindow = null;});
  mainWindow.loadURL(entry).catch(error => {
    if (!testMode) dialog.showErrorBox('Layout Studio could not start', error.message);
    console.error(error);
    app.exit(1);
  });
}

function installMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{role:'appMenu'}] : []),
    {label:'File', submenu:[{label:'Open saved-data folder', click:() => shell.openPath(profile)},
      {type:'separator'}, mac ? {role:'close'} : {role:'quit'}]},
    {role:'editMenu'},
    {label:'View', submenu:[{role:'reload'}, {role:'toggleDevTools'}, {type:'separator'},
      {role:'resetZoom'}, {role:'zoomIn'}, {role:'zoomOut'}, {type:'separator'}, {role:'togglefullscreen'}]},
    {role:'windowMenu'},
    {label:'Help', submenu:[{label:'About Layout Studio', click:() => dialog.showMessageBox(mainWindow, {
      type:'info', title:'Layout Studio', message:`Layout Studio ${app.getVersion()}`,
      detail:'Offline layout editing, motion planning and recording.\n\nUse Import and Export for portable scenes. To transfer browser snapshots, export them from the browser Snapshots panel and import them here.',
    })}]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (mainWindow) {mainWindow.restore(); mainWindow.show(); mainWindow.focus();}});
  app.whenReady().then(async () => {
    const html = fs.readFileSync(path.join(root, 'viewer.html'), 'utf8');
    const studioSession = session.fromPartition('persist:layout-studio');
    studioSession.protocol.handle(SCHEME, createAssetHandler(root, url => net.fetch(url), contentSecurityPolicy(html)));
    studioSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
    studioSession.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen');
    studioSession.on('will-download', (_event, item) => {
      // Keep all existing Blob/SVG/GLB/video exports, with the OS save dialog.
      item.setSaveDialogOptions({title:'Save Layout Studio export',
        defaultPath:path.join(app.getPath('downloads'), path.basename(item.getFilename()))});
    });
    installMenu();
    createWindow();
    app.on('activate', () => {if (BrowserWindow.getAllWindows().length === 0) createWindow();});
  }).catch(error => {console.error(error); app.exit(1);});
  app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
}
