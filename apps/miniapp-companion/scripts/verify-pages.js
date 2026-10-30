// 校验 app.config.ts 的 pages[] 声明与 src/pages 下的实际文件一一对应
// 用法：node scripts/verify-pages.js
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const src = fs.readFileSync(path.join(root, 'src/app.config.ts'), 'utf8')

// 只取 pages: 到下一个同级键（subpackages）之间的内容
const pagesIdx = src.indexOf('\npages:')
const subIdx = src.indexOf('\nsubpackages:')
const block = src.slice(pagesIdx + 1, subIdx === -1 ? undefined : subIdx)
// pages[] 里只有单引号路径；用 [ ] 边界避免把后面的对象/字符串也吃进来
const arrMatch = block.match(/\[[\s\S]*?\]/)
const declared = arrMatch ? Array.from(arrMatch[0].matchAll(/'([^']+)'/g)).map((m) => m[1]) : []

const missing = declared.filter((p) => {
  const base = path.join(root, 'src', p)
  return !fs.existsSync(base + '.tsx') && !fs.existsSync(base + '.jsx') && !fs.existsSync(base + '.ts')
})

// 声明里是 'pages/xxx/index'，目录名要剥掉 pages/ 与 /index 两段
const declaredDirs = declared
  .filter((p) => p.startsWith('pages/'))
  .map((p) => p.replace(/^pages\//, '').replace(/\/index$/, ''))
const extra = fs
  .readdirSync(path.join(root, 'src/pages'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => !declaredDirs.includes(name))

console.log('pages[] 声明数:', declared.length)
console.log(declared.join('  '))
console.log('缺失文件:', missing.length ? missing.join(',') : '无')
console.log('未声明的目录:', extra.length ? extra.join(',') : '无')
process.exit(missing.length || extra.length ? 1 : 0)