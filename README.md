# LACT 观测规划台

面向 LACT 的 TeV 源查询与观测规划网站。先比较每个源的全年观测窗口，再进入同一晚的轨迹、邻近源与任务排班；附带不使用太阳／月亮限制的 LHAASO 几何过境模式。

LHAASO 模式用于年度／月度源表统计；单夜排班与指向输出始终使用 LACT 观测条件。LHAASO 的过境可见性不会被当作望远镜指向任务。

[在线使用](https://yun532.github.io/LACT-observation-plan/) · [源表来源](docs/DATA.md) · [计算口径](docs/ASTRONOMY.md)

## 使用流程

1. 在「源与观测窗口」选择年份，搜索名称、别名或类型，按所选月／全年时长、个人优先级或 TeVCat 流强参考排序。源表热图展示每月的可观测小时数，也可切换天空分布。
2. 选择一个源和月份，查看逐日窗口，再进入指定夜晚。单夜工作台同时显示天顶角、月距、可观测时段、天顶角分布及附近 5° 的目录条目；可叠加源的轨迹。
3. 将候选源拖入时间轴，移动任务或拖动边缘调整时长；也可通过表单精确输入。冲突检查包括可观测条件、任务重叠、最小时长与转场预留。同一源的相邻任务不收取换源转场时间。
4. 核对计划后下载任务 CSV、指向采样 CSV 或完整 JSON。草稿 JSON 可重新导入，继续编辑。参数设置可修改站址、时区、太阳与月亮限制、天顶角、视场和排班偏好。

网站在浏览器本地计算，无须登录或后端服务。个人标记及草稿保存在当前浏览器；换设备或清理浏览器前请导出 JSON。年度计算在 Web Worker 中运行，不会把源列表发送给远程计算服务。

## 数据与时间口径

- 当前目录快照包含 **363 条 TeVCat 公开记录及 90 个 1LHAASO 源**。这是目录条目数，跨目录可能是同一物理源。默认显示已确立／新宣布条目，争议和候选源可通过筛选查看。
- 数据为随版本发布的快照，获取日期、原始出处及完整性统计保存在 `public/data/sources.json` 的 `meta` 中；源名称、别名、坐标和科学量保留出处。缺失值不填零，未探测分量保留上限标志。
- TeVCat 的 Crab 单位流强存在不同能阈和观测历元；1LHAASO 的 WCDA／KM2A 归一化流强具有不同参考能量和单位。不能将所有原始数值混排为统一亮度。
- 默认站址：纬度 **29.3586111° N**、经度 **100.1374972° E**、海拔 **4410 m**、固定时区 **UTC+8**。默认天顶角上限 70°、太阳高度上限 −13°、月距下限 40°，来自原观测 Notebook。
- 单夜详细图为本地 **18:00 至次日 08:00**，采用 1 分钟步长。年度／月度累计采用 10 分钟中点积分，实际计算每个日历日；LACT 以当地中午至次日中午为一个观测日，LHAASO 以 00:00–24:00 为一个日历日。
- 固定 UTC 偏移不会自动应用夏令时。改变站址后，单夜 14 小时视窗未必覆盖当地所有暗夜，全天累计应查看月度／年度结果。

更多分量选择、流强、扩展尺度及数据重建说明见 [DATA.md](docs/DATA.md)。算法、坐标系、采样与参考对照见 [ASTRONOMY.md](docs/ASTRONOMY.md)。

## 本地运行

安装 Node.js 24 和 npm，在仓库根目录运行：

```sh
npm ci
npm run dev
```

访问终端显示的本地地址。生产构建及预览：

```sh
npm test
npm run build
npm run preview
```

构建输出为 `dist/`。Vite 使用相对资源路径，支持部署到 GitHub Pages 的仓库子路径。开发依赖已锁定在 `package-lock.json`；运行时不依赖外部脚本 CDN。

## 更新源表

源表结构为 `{ "meta": {...}, "sources": [...] }`。每条记录必须有稳定的字符串 `id`、`name`、`catalog`、度单位的数值 `ra/dec`；其他科学字段及原始分量保留在记录中。完整字段说明见 [DATA.md](docs/DATA.md)。

导入器只使用 Python 3 标准库。离线重建与在线刷新命令分别为：

```sh
python scripts/import_catalog.py --output public/data/sources.json
python scripts/import_catalog.py --refresh --output public/data/sources.json
```

离线重建会校验 `data/raw/` 中缓存快照的 SHA-256；刷新后需一并提交新快照、目录 JSON 和质量报告，并审阅变化。日常网站构建直接使用已提交的 JSON，不联网抓取目录。

## 部署

在仓库 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。推送至 `main` 后，[部署工作流](.github/workflows/deploy.yml) 依次运行 `npm ci`、测试、构建，再将 `dist/` 发布至 GitHub Pages。Pull request 只执行测试和构建。

工作流使用 GitHub 官方 [自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)，通过 `github-pages` 环境部署，不需要自建访问令牌。

## 适用范围

这里的「可观测时间」是满足几何约束的时长，未扣除天气、设备停机和实际探测效率。5 min 转场与 3° 视场半径是可调规划默认值，尚不是经核准的 LACT 设备模型。

指向导出包含 UTC／本地时间、ICRS 源中心坐标及无大气折射的几何高度／方位角；方位角自北向东增加，`END_EXCLUSIVE` 标记任务结束边界。未实现 wobble 指向、设备限位、转速／加速度、线缆缠绕、地形遮挡及控制系统协议，**导出文件不能直接作为望远镜硬件控制指令**。

临近目录位置用于辅助选择和对比，并不单独给出源混淆或污染结论。判断污染还需要扩展形态、PSF、背景区域和具体分析方法。

## 检查与维护

`npm test` 使用 Node 原生测试运行器，无额外测试框架。测试覆盖采样与 Astropy 参考值的角度对照、闰年与跨年、极昼、LHAASO 全天统计、任务重叠与转场、时区换日、计划导入和 CSV 公式防护。参考值是原 Notebook 站址下四个源、三个夜晚的固定样本，不能替代真实设备验收。

天文计算依赖 [Astronomy Engine](https://github.com/cosinekitty/astronomy)；目录学术引用与数据出处见 [DATA.md](docs/DATA.md)。
