# 恒星层的数据与画法

本次使用用户指定的 `SII_target_catalog_20260916_mag14` 数据集，生成全天 **V≤8** 的公开亮星目录层。数据只包含目录名称、坐标、V 星等及其来源、自行和历元，没有私有观测结果、SII 测量、目标优先级或温度等分析字段。

## 覆盖

`public/data/stars.json` 包含 **47,114 条目录记录**，默认 V≤3 显示范围内有 188 条。这里是目录记录数；双星/多星系统与其分量可能同时存在，不应把记录数解释为完全独立的恒星数量。天狼星、织女星等 Gaia 欠缺的极亮星已从同目录的 SIMBAD 全天表补齐。

| 输入 | 使用方式 | 结果 |
|---|---|---:|
| `gaia_enriched_allsky.parquet` | Vmag≤8，保留所有赤纬，无中天高度切选 | 45,578 条 |
| `simbad_v14_with_coordinates.parquet` | V≤8、恒星/多星分类、没有已收录的同一 SIMBAD oid | 1,536 条补充 |

没有使用经过“LACT 中天高度≥30°”裁剪的 `lact_v14_parent.parquet`；因此站点、日期、天顶角阈值变化时，不会因该裁剪漏掉低中天高度天区。

Gaia 输入的 V≤8 子集原有 45,580 条，排除主分类为非恒星的 2 条。SIMBAD 原始 V≤8 子集有 45,959 条：排除主分类为星系、星团、星协、历史超新星等，或只按 UV/X 发现而未有恒星分类的 227 条；44,196 条已有确切 oid 对应，其余 1,536 条补入。Gaia 中 1,335 条没有 SIMBAD 分类的点源记录仍保留。未按角距离自动合并对象。

这是完整导出的**该数据集所含亮星记录**，不是恒星完备性声明。光变、双星混合测光、分类变化、原始源表缺失等仍可能影响实际观测背景。V 值是目录测光，不能解释为所选夜晚的实时亮度。

独立质量复核：全部数字均有限，无 NaN/Infinity、空名或残留 HTML。50 条抽样（含天狼星与织女星）的名称、坐标、V 值和自行，与服务器原始列逐项相符，差异不超过输出舍入精度。ID 全部唯一，但有 10 个重复显示名、30 组同历元坐标完全相同的不同 SIMBAD ID；按可用自行传播至 2000.0 后，共有 935 对角距离小于 1″，其中 667 对跨 Gaia/SIMBAD。它们是需要进一步确认的重复/系统分量候选，不能只因位置接近就合并，也不能把这些条目的测光相加当作独立星光。图中叠在一起的标记及记录计数应按此理解。

## 星等

所有记录 `band: "V"`，不会用 Gaia G 代替 V。更小的数值表示更亮；负星等仍正常显示。V 的三个来源各自保留在 `photometrySource` 中：

| photometrySource | 上游标注 | 条数 |
|---|---|---:|
| `simbad-v` | SIMBAD V；上游合并表称 SIMBAD Johnson V | 37,517 |
| `jsdc-v` | Original JSDC Johnson V | 8,963 |
| `gaia-synthetic-v` | Gaia GSPC synthetic Johnson–Cousins V | 634 |

这些都是 V 波段口径，但实测目录 V 与由 Gaia XP 谱合成的 V 并非同一次测量。原始服务器汇编没有保留逐条 SIMBAD V 的测光系统标志、参考文献、误差与光变幅度；因此不声称所有 V 数值具有相同零点、误差或历元。界面可以用于亮星筛查，不应用它做高精度测光对比。

参考：[SIMBAD 内容与测光说明](https://simbad.cds.unistra.fr/Pages/guide/ch15.htx)、[JMMC JSDC](https://www.jmmc.fr/jsdc)、[Gaia GSPC 合成测光论文](https://doi.org/10.1051/0004-6361/202243709)。JSDC 的具体输入版本采用服务器汇编给出的来源标记，本次未重新推断版本。

## 坐标与自行

坐标轴均为 ICRS，`ra` 和 `dec` 的单位是度，但每条记录的**位置历元**不同：

- Gaia DR3：`epochJYear: 2016`，45,578 条。服务器原始 ADQL 明确直接选择 `gaiadr3.gaia_source.ra/dec/pmra/pmdec`；没有在导出时重标为 J2000。
- SIMBAD 基础坐标：`epochJYear: 2000`，1,536 条。SIMBAD 文档明确基础坐标按 ICRS、epoch 2000.0 存储。
- `pmRA` 和 `pmDec` 单位均为 mas/yr，其中 **pmRA = cos(dec) × dRA/dt**。它是沿赤经方向的切平面角速度，不能再额外乘一次 cos(dec)。
- 1,191 条没有完整的两分量自行，输出省略两字段；这不表示自行测量值为零。显示时可维持原坐标并说明缺少自行。

坐标保留小数点后 7 位，自行保留 3 位，远小于本网站视场/邻近源规划的角度精度。位置更新应使用每条记录自己的 `epochJYear` 和切平面自行；此处没有添加视差、径向速度、双星轨道或大气折射模型。

参考：[Gaia DR3 坐标与自行字段](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html)、[Gaia DR3 发布内容](https://www.cosmos.esa.int/web/gaia/dr3)、[SIMBAD 坐标历元与自行](https://simbad.cds.unistra.fr/Pages/guide/ch15.htx)。

## 文件与更新

结构为 `{meta, stars}`，每条恒星至少有：

```json
{
  "id": "star:simbad-8399845",
  "name": "* alf CMa",
  "ra": 101.2871553,
  "dec": -16.7161159,
  "mag": -1.46,
  "band": "V",
  "epochJYear": 2000,
  "photometrySource": "simbad-v",
  "pmRA": -546.01,
  "pmDec": -1223.07
}
```

`meta` 保存源文件名称、修改时间、行数、读取列白名单、筛选统计与标准化记录 SHA-256。没有保存内部服务器地址、账号、凭据路径或绝对服务器目录。JSON 约 9.1 MB，gzip 约 1.90 MB；绘图应先按星等和视场做几何预筛，再计算细致的时间相关坐标。

```sh
# 本机只有 Python 标准库即可；PyArrow 仅需安装在存放 Parquet 的服务器上。
# 只读原始数据，将最小科学字段传回本地；不会在服务器写入脚本或文件。
python scripts/import_stars.py --ssh-host USER@HOST --identity /path/to/key --source-dir /path/to/catalog

# 也可在拥有 Parquet 与 PyArrow 的本地运行。
python scripts/import_stars.py --source-dir /path/to/catalog

# 不访问服务器，核对已发布快照的 schema、校验和、坐标、星等、亮星补充。
python scripts/import_stars.py --check
```

固定同一份输入可重现相同的标准化记录与 `recordsSha256`；每次重新提取只改变抓取时间等元数据。脚本校验唯一 ID、坐标范围、统一 V 波段、历元/自行约定，以及天狼星、织女星存在且亮星系和历史超新星未混入。

## 当前扩展 TeV 源显示口径

恒星光点、源的发射区域、位置误差、望远镜视场是不同量，图例与描边应明确区分。

**1LHAASO**：`extension.kind = "gaussian-r39"` 的 `radiusDeg` 是二维高斯模型的 39% 包容半径，不是发射的硬边界。当前两张天图都绘制目录顶层所选参考分量的角半径 r39 轮廓：实测值为细实线；`upperLimit: true` 为虚线，提示注明“95% 上限”。邻近源图为实测圈加很轻的填色，上限圈不填色；站址全天图只画轮廓。圈先在天球上构造，再投影，不能把屏幕上的像素半径直接当作角半径。

目前没有同时叠加一个目录源的 WCDA 与 KM2A 两个分量。分量信息保留在数据中；各分量具有自己的中心和形态，不能用另一分量的坐标代替。`positionError95Deg` 是定位误差，目前未把它画成源展宽，也不能替代 r39。

**TeVCat**：`extension.kind = "catalog-angular-size"` 保存目录 `xDeg/yDeg`，官方说明只称赤经/赤纬方向的角尺度，未统一说明是半径、全宽、直径或高斯参数，也未提供统一位置角。因此不能对所有条目统一除以 2、把它们当椭圆半轴、或把显示轮廓当成物理边界。**当前站址全天图和邻近源图都不为这种未统一定义的角尺度绘制轮廓**，仅绘制源的位置点，并在悬浮提示列出可用的目录角尺度及定义提示。没有把 max(xDeg,yDeg) 画成“保守半径”。定量形态或污染判断仍需查具体源论文。

当前快照中，TeVCat 有 121 条带角尺度、242 条无角尺度，2 条只提供一个方向的值。1LHAASO 顶层有 61 条实测 r39、29 条 r39 上限；探测器分量共有 103 条实测、41 条上限、36 条没有独立测得形态。任何两圈相交都不自动等于污染：还依赖能段、PSF、提取区域和背景分析方式。

来源：[TeVCat 字段说明](https://heasarc.gsfc.nasa.gov/W3Browse/catalog/tevcat.html)、[1LHAASO 论文 Table 2 与表注](https://arxiv.org/html/2305.17030v2)。
