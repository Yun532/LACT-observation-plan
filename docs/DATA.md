# 源表来源与数据口径

快照获取时间：**2026-09-22 05:57:51 UTC**。这是一份随网站发布的公开目录快照，并非实时更新源表。

## 完整性

| 目录 | 本次记录数 | 覆盖范围 |
|---|---:|---|
| TeVCat | 363 | 官网内嵌数据对象中的全部公开条目；已确立 304、新宣布 33、争议 10、候选 16 |
| 1LHAASO | 90 | 第一版 LHAASO 源表全部源；保留 180 条 WCDA/KM2A 分量记录 |
| 合计 | 453 | **目录条目数，不能解释为 453 个独立物理源** |

默认建议展示 TeVCat 已确立和新宣布源，以及全部 1LHAASO 源，共 427 条；用户可以显示全部条目。争议和候选源仍收录并带状态，避免将未确立目标当作确定探测。

没有依据位置接近、名称相似或可能关联自动合并两个条目。1LHAASO 同一目录源的两个探测器分量按原始源名归组；这是目录定义的分量关系。跨目录关联只保存在 `associations` 中。

## 原始数据

### TeVCat

- 直接来源：[TeVCat 官方目录](https://tevcat.org/)。提取页面 `dataObj.sources` 的完整数组，不依赖当前表格页码、地图视野或查询筛选。
- 本次数组总数和公开记录数均为 363。保留原站的数值源 ID，记录标识为 `tevcat-<id>`；详情链接使用 `?mode=1&showsrc=<id>`。
- 缓存 `data/raw/tevcat-public-metadata.json` 是原始公开科学字段的投影，保存所有公开行。原页面中的长篇注释、私人字段、账号字段、HTML/JavaScript 和跟踪代码不随网站传播。
- 原始网页响应的 SHA-256、大小以及投影快照的 SHA-256 记录在 `data/raw/manifest.json`。
- 字段说明也可参考 [NASA HEASARC TeVCat 说明](https://heasarc.gsfc.nasa.gov/W3Browse/catalog/tevcat.html)。本项目实际数据来自 TeVCat 官网，不来自该镜像。
- 学术使用请引用 **Wakely, S. P. & Horan, D. 2008, ICRC, 3, 1341**，bibcode `2008ICRC....3.1341W`，并注明 TeVCat。

赤经的时分秒转换为度；赤纬的正负号作用于整个角度，包括负零度。保留源分类、别名、发现时间、观测设施以及可用的流强、谱指数和角尺度。未提供的数值为 `null`。

TeVCat 的 `flux` 为目录代表性 **Crab 单位**，`eth` 为 **GeV**。已用 [Crab 详情页](https://tevcat.org/?mode=1&showsrc=74) 的标注核实。各条目的阈值、历元和源状态可能不同，不能把这个数值解释为统一能段下的精确亮度；不生成统一能段换算。原站缺少流强的 174 条记录保留缺失。

`extension.xDeg/yDeg` 保留目录的角尺度字段，不统一解释为高斯标准差、包容半径或视场半径。画邻近源时应区分位置和形态，不能把两条接近的记录直接判作互相污染。

### 1LHAASO

- 直接数据：[LHAASO 团队在 China-VO 发布的完整 CSV](https://casdc.china-vo.org/archive/LHAASO-Gamma-Ray-sources/table.csv)。快照原样保存为 `data/raw/lhaaso-table.csv`。
- 论文：[Cao et al. 2024, ApJS 271, 25](https://doi.org/10.3847/1538-4365/acfd29)，第一版 LHAASO 源表，Table 2。可读的 [arXiv 论文及表注](https://arxiv.org/html/2305.17030v2#S4.T2) 描述分量、标志和流强定义。
- 独立复核：[CDS/VizieR J/ApJS/271/25](https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/271/25) 的 `catalog.dat` 与 `ReadMe`，同时保留在 `data/raw/` 中。144 条被探测分量的坐标与原始 CSV 全部一致。
- 目录有 90 个源，69 个 WCDA 探测、75 个 KM2A 探测、54 个同时探测、43 个带 `u` 标志的超高能源。导入脚本会对上述计数进行断言。

位置：顶层 `ra/dec` 使用被探测分量中 TS 最大的分量，对应目录命名口径。`coordinateComponent` 明确记录是哪一分量；`components` 保留两者各自坐标、位置误差与 TS。不探测分量的原始 CSV 坐标为空，仍保留为空，**不借用另一分量的位置冒充独立定位**。

流强：采用 `dN/dE = N0 (E/E0)^(-Gamma)`。

| 分量 | E0 | CSV 中 N0 的单位 | 输出 value 的单位 |
|---|---|---|---|
| WCDA | 3 TeV | 10⁻¹³ cm⁻² s⁻¹ TeV⁻¹ | cm⁻² s⁻¹ TeV⁻¹ |
| KM2A | 50 TeV | 10⁻¹⁶ cm⁻² s⁻¹ TeV⁻¹ | cm⁻² s⁻¹ TeV⁻¹ |

顶层流强优先取已探测的 WCDA 分量，缺少 WCDA 探测时取 KM2A，并记录 `fluxComponent`；两个原始分量始终保留。CSV 用 `N0=0` 和误差列存放未探测分量的 95% 统计上限，转换为 `upperLimit: true`，不是零流强。

形态：`r39` 是二维高斯的 39% 包容半径。CSV 的 `r39=0` 对应点状分量的 95% 统计上限，限值在误差列；输出保持上限标志，不把该限值画成测得的扩展半径。

关联源的角距离按论文 Table 2 使用**度**。CDS ReadMe 将 `Sep` 列写成 `arcsec`，与原表 `Sep.[°]` 和数值不一致，因此未采用该单位。CSV 原始源名的 `u`、`*` 以及分量名的 `*` 分别保存为 `uhe`、`dubiousMerged`、`gdeImpact`。Table 2 没有逐源物理分类，故此处为 `Unclassified`，不凭可能关联推断物理类型。

## 网站消费约定

- 基本字段：`id, name, catalog, ra, dec, type, aliases, reference, status, defaultIncluded`。
- `flux` 可为 `null`；非空时包含 `value, unit, energy, kind, comparisonGroup`。比较流强时首先选择同一组；TeVCat 组内阈值仍有差异，应标明“目录代表流强”。
- `extension` 可为 `null`；TeVCat 角尺度与 LHAASO 高斯包容半径是不同量。
- 1LHAASO 的 `associations` 是目录报告的可能对应体，**不等于 aliases**。
- `meta.quality` 记录数量、缺失值、重复 ID 与完整性检查结果。`completeWithinSnapshot` 只表示完整导入本次公开快照，不表示全宇宙或未来的新源都已收录。
- 坐标均按目录报告的 J2000 坐标使用；没有添加自行拟合的自行、位置误差或源分类。

## 重建与更新

只需 Python 3 标准库，不需要 Astropy、数据库或密钥。

```powershell
python scripts/import_catalog.py --output public/data/sources.json
python scripts/import_catalog.py --refresh --output public/data/sources.json
python scripts/import_catalog.py --output path/to/sources.json
```

默认离线读取 `data/raw/` 快照，并校验 SHA-256 后重建 `public/data/sources.json`；`--refresh` 才访问网络。新快照包含抓取时刻，后续版本源数可能改变。LHAASO 第一版固定为 90 源；TeVCat 计数动态报告。每次运行同时检查唯一标识、坐标范围、目录完整性、LHAASO 分量统计、Crab 转换及上限保留，写出 `data/quality-report.json`。
