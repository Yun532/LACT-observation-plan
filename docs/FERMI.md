# Fermi 可选目标库

使用 NASA FSSC 正式公开的 [4FGL-DR4 v35](https://fermi.gsfc.nasa.gov/ssc/data/access/lat/14yr_catalog/)，覆盖 2008-08-04 至 2022-08-02，目录分析能段为 50 MeV–1 TeV。网站将其作为按需加载的可选目标库；选入观测源表后，才参加年度可观测时间计算。几何可观测并不代表 LACT 能探测到该源。

官方页面列出 7194 个源，而官方 FITS 有 **7195 条目录记录**。Crab 星云的逆康普顿和同步辐射分量分占两行，连同脉冲星共三条记录，对应两个天体。本网站完整保留记录及其名称，不悄悄删掉或合并谱分量。

## 可追溯的字段

字段定义参考 [HEASARC 官方说明](https://heasarc.gsfc.nasa.gov/w3browse/fermi/fermilpsc.html) 和原始 FITS 表头。

| 网站字段 | 原始字段／含义 |
| --- | --- |
| 赤经、赤纬 | `RAJ2000`、`DEJ2000`，度；表头为 FK5、J2000 |
| 主关联、替代关联 | `ASSOC1`、`ASSOC2`；后者可能是低置信关联或所在延展源，不能自动认定同一天体 |
| 类别 | `CLASS1` 保留大小写；大写为确认识别，小写为关联 |
| 光子流强 | `Flux1000`，**1–100 GeV** 积分光子流强，ph cm⁻² s⁻¹；误差为原表 `Unc_Flux1000` |
| 能量流强 | `Energy_Flux100`，**0.1–100 GeV**，erg cm⁻² s⁻¹ |
| 谱指数 | 按 `SpectrumType` 读取 `PL_Index`、`LP_Index` 或 `PLEC_IndexS`；弯曲谱两者是枢轴能量处的局部指数，不能当作全能段固定幂律 |
| 显著性、变化指数 | `Signif_Avg`、`Variability_Index`，保留目录原值；不是当前活动状态 |
| 质量标志 | `Flags` 位掩码；非零表示目录提示系统误差或分析问题 |
| 高能关联 | 原表 `ASSOC_FHL`：1555 条，其中 1536 条指向 3FHL、13 条 1FHL、6 条 2FHL |
| TeV 关联 | 原表 `ASSOC_TEV`、`TEVCAT_FLAG`，保留公开目录给出的可能关联，不进行新的自动位置合并 |
| 定位误差 | 95% 置信椭圆的半长轴、半短轴、位置角；与源展宽分开 |
| 空间模板 | `ExtendedSources` 表的模型名称、模型形式、两个尺度、位置角、模板文件名，保留原始语义 |

可搜索别名包含原表的关联与旧目录名称，搜索命中不代表已经证实物理对应。FHL 筛选是 **4FGL 中已有 FHL 关联的记录**，并非完整 3FHL 源表，也不等于已在地面 TeV 波段探测。平均 GeV 流强不能与 TeVCat 的 Crab 流强或 LHAASO 某能量处的微分流强直接混排比较。

82 条延展记录保留 Disk、2D Gaussian、Map 或 Ring 的模板参数。本轮没有把不同模板的尺度统一换成圆形高斯展宽，`extension` 置空；源信息仍可查看原始空间模板。没有把定位误差当作物理展宽。

## 重建与来源校验

```sh
python scripts/import_fermi.py
# 或使用已有的同一个官方公开文件，仍会校验完整 SHA256：
python scripts/import_fermi.py --input /path/to/gll_psc_v35.fit
node --test tests/fermi-catalog.test.js
```

重建需要 Python 与 Astropy，网站运行不增加依赖。导入脚本固定下载 [官方 gll_psc_v35.fit](https://fermi.gsfc.nasa.gov/ssc/data/access/lat/14yr_catalog/gll_psc_v35.fit)，只接受 SHA256 `e3b3ea278412b7bda4c259ab558f00b76605be59eb84e44086a862a179ffc3e6`。输出 `public/data/fermi-sources.json`，仅含公开目录选定字段；数值保留八位有效数字，缺失值为 `null`。没有读取本地非公开 LHAASO 数据或既有混合天图导出。

2026-09 核验时，NASA 还提供 [FL16Y 初步列表](https://fermi.gsfc.nasa.gov/ssc/data/access/lat/fl16y/) 以及 2026-08 发布的 [4FHL 初步版](https://fermi.gsfc.nasa.gov/ssc/data/access/lat/4FHL/)（50 GeV–2 TeV）。本轮使用正式 4FGL-DR4，后续可将这些目录作为明确标注版本与初步状态的独立选项，而不无声覆盖现有目标标识。
