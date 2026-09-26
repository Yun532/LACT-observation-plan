# 天空分布：设计与公开底图备选

本轮参考用户的 [Neutrino-Sky 网页](https://yun532.github.io/Neutrino-Sky/)
与 [代码仓库](https://github.com/Yun532/Neutrino-Sky)，借鉴其天图展示思路；
目标是让视图、图层、坐标和关注源的操作更清楚，保留 LACT 的源筛选与观测规划逻辑。
天空分布适合探索目标，单夜工作台负责判断具体夜晚的轨迹与观测窗口。

源信息卡进一步参考 Neutrino-Sky 对目录参数的整理方式，直接呈现现有 TeVCat 的分类、别名、发现设备、流强与谱指数，以及 LHAASO 各探测器分量和本地模型字段。没有复制旧网页中包含本地匹配结果的混合导出。Fermi 单独作为按需加载的检索库，已选条目才进入当前天图与年度计算，目录着色使用紫色。详情见 [FERMI.md](FERMI.md)。

当前底图**没有伽马射线强度层**。银道参考线、坐标网格和源标记都是辅助信息。
全天图的银道转换采用标准 J2000 赤道到银道旋转；在此显示精度下将 ICRS 与 FK5/J2000 近似重合。源卡和输出继续保留各目录声明的原坐标系，未改写科学坐标。
“几何可达天区”（原“站址过境边界”）用浅绿色填充，表示上中天时能满足天顶角限制的区域。
条件是 `|赤纬 − 台站纬度| ≤ 天顶角上限`，并截断至赤纬 −90° 至 +90°。
默认台站纬度 29.3586111°、天顶角上限 70°，对应赤纬 −40.6413889° 至 +90° 的全部赤经。
它不是某一时刻同时可见的天空，也不包括暗夜、太阳和月亮条件；指定夜晚的可观测时长仍由现有算法计算。

蓝色“目标视场”以当前预览源为中心，按球面角距填充半径以内的区域；边界按球面圆绘制。
它与单夜邻近图共用视场半径设置，默认半径 3°、直径 6°，可在天图旁修改并放大查看。
该圆为观测规划的近似，不是相机精确轮廓，也不表示各位置灵敏度相同。
源卡可展开视场内目录记录：使用全部已载入目录、按源中心角距判断，不受顶部源筛选限制；
跨目录条目不合并，延展源的中心在视场内不代表其延展全部包含。
两类区域都有独立开关，填充在源点下方；赤道／银道转换、全天接缝与极区使用同一球面判定。

## 可借鉴的方向

- 用清楚的背景、网格和标记层次帮助读图，源标记与文字保持对比度。
- 将坐标系、视图复位、缩放和图层开关集中在天图附近，明确当前状态。
- 关注源的信息与操作紧邻天图；密集区域保留可辨认、可选择的目标入口。
- 后续真实影像底图应具有独立色标、透明度、版本、覆盖范围与出处，默认保持清爽。

## 公开背景候选（调研于 2026-09-26，尚未接入）

| 候选与官方来源 | 可用数据 | 用途与边界 |
| --- | --- | --- |
| [Fermi LAT 3–300 GeV：CDS／HEASARC](https://alasky.cds.unistra.fr/MocServer/query?ID=CDS/P/Fermi/5&fmt=html&get=record) | 公开 JPEG／FITS HiPS，赤道坐标；其他能段也有产品。 | 优先用于银河弥散辐射和 GeV 源环境。是累计天空背景，不能表示当晚状态；接入前核实观测时间、产品版本和单位。 |
| [HAWC 3HWC](https://data.hawc-observatory.org/datasets/3hwc-survey/fitsmaps.php) | HEALPix FITS，NSIDE=1024，RA/Dec J2000；含 ±√TS 显著性及 7 TeV 枢轴能量处的微分流强、上下限。 | 与 TeV 观测相关性强。标明点源／延展源假设、谱指数 −2.5；无曝光或无效像素透明处理，不能视为零信号。 |
| [Planck GNILC 尘埃](https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/foregrounds.html) | τ353 光学深度 FITS：银道坐标、HEALPix NSIDE=2048、5′ FWHM，含误差；详见 [FITS 头](https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/previews/COM_CompMap_Dust-GNILC-Model-Opacity_2048_R2.01/header.txt)。 | 用于星际介质和分子云环境参照。尘埃不是 TeV 强度，也不能单凭投影重叠认定物理关联。 |
| [LHAASO 官方公开数据](https://english.ihep.cas.cn/lhaaso/pdl/202110/t20211026_286779.html) | 已核实论文配套局部数据和绘图代码；例如 Crab 的 0.1°×0.1° 像素表含 RA、Dec、Non、Nb、显著性。 | 最贴合 LACT 科学用途，但本轮未核实到完整官方全天 FITS／HiPS。[公开一期源表](https://nadc.china-vo.org/res/r100752/)是源表；[发布图](https://english.ihep.cas.cn/nw/han/y24/202402/t20240229_657801.html)不能直接充当精确坐标底图。 |
| [DSS2 光学彩色：STScI／NASA／CDS](https://alasky.cds.unistra.fr/MocServer/query?ID=CDS%2FP%2FDSS2%2Fcolor&fmt=html&get=record) | 赤道坐标 JPEG HiPS，摄影巡天红蓝底片合成；存在少量缺失底片。 | 可选的局部视场辨认背景。颜色不等于定量星等，不能替代现有亮星目录、符号和星等筛选。 |

建议接入顺序为 Fermi → HAWC → Planck；LHAASO 待有明确可用的公开像素数据后再加入。
不将 Fermi 的弥散背景模型冒充实测强度图；官方对其大尺度结构用途有
[明确限制](https://fermi.gsfc.nasa.gov/ssc/data/access/lat/BackgroundModels.html)。
HiPS 是渐进分辨率影像格式，接入前应保留各产品的署名和许可条件，参见
[CDS 官方说明](https://aladin.cds.unistra.fr/hips/)。

## 私有源目录与底图隔离

优先在发布前离线生成固定、公开的全天底图，随网站加载；重投影、源选择与私有源叠加只在浏览器完成。
公开底图的制作输入不得混入私有源表、私有源位置或观测计划。
不将私有名称、坐标和视场查询发送到 SkyView、SIMBAD、HiPS2FITS 等外部服务。

第三方瓦片请求即便没有源名，瓦片编号也可能暴露正在查看的天空区域。
因此精细远程瓦片应作为明确可选功能，默认使用固定的本站公开底图；
不因为切换或定位私有目标而自动发起外部区域请求。

1.0 的保存和恢复方法见 [ROLLBACK.md](ROLLBACK.md)。
