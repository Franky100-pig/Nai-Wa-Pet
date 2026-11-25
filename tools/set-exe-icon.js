/**
 * 给 Windows 的 exe 换图标。
 * 用法：node tools/set-exe-icon.js <exe 路径>
 * 换完 Authenticode 签名会失效（本来也没签），Windows 照样能跑。
 */
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

const exePath = process.argv[2];
if (!exePath || !fs.existsSync(exePath)) {
  console.error('用法: node tools/set-exe-icon.js <exe>');
  process.exit(1);
}
const icoPath = path.join(__dirname, '..', 'assets', 'AppIcon.ico');
if (!fs.existsSync(icoPath)) {
  console.error('缺少 assets/AppIcon.ico，先跑 python3 tools/make-ico.py');
  process.exit(1);
}

const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const icons = ico.icons.map((i) => i.data);

const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
if (groups.length === 0) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icons);
} else {
  for (const g of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, icons);
  }
}

// 顺手把「属性 → 详细信息」里的 Electron 改成自己（不改也能跑，只是难看）
try {
  const pkg = require('../package.json');
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vis.length) {
    const vi = vis[0];
    const [a, b, c] = (pkg.version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: '奶蛙桌宠',
      ProductName: '奶蛙桌宠',
      CompanyName: 'Franky100-pig',
      LegalCopyright: 'personal use only',
      OriginalFilename: 'NaiwaPet.exe',
      InternalName: 'NaiwaPet'
    });
    vi.setFileVersion(a, b, c, 0, 1033);
    vi.setProductVersion(a, b, c, 0, 1033);
    vi.outputToResourceEntries(res.entries);
    console.log('版本信息已改');
  }
} catch (e) {
  console.log('版本信息没改成功（不影响运行）:', e.message);
}

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log(`图标已写入 ${path.basename(exePath)}（替换 ${groups.length || 1} 组，${icons.length} 帧）`);
