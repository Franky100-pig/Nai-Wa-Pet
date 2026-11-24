const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', hasShadow: false
  });
  await win.loadFile(path.join(__dirname, '..', 'assets', 'icon.html'));
  await new Promise((r) => setTimeout(r, 900));
  const img = await win.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), img.toPNG());
  console.log('saved', JSON.stringify(img.getSize()));
  app.quit();
});
