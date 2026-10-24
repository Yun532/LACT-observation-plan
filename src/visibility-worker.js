import { computeYear, computeMonth, computeNight, computeZenithDistribution } from './astronomy.js';
import { summarizeNight } from './night-catalog.js';

self.onmessage = ({data}) => {
  const {id,type,scope,year,month,date,sources,config}=data;
  try {
    if(!['year','month','night-catalog','zenith-distribution'].includes(type)) throw new Error('未知计算请求');
    if(type==='zenith-distribution'&&(!Array.isArray(sources)||sources.length!==1)) throw new Error('天顶角分布每次需要且仅接受一个源');
    const result=type==='zenith-distribution' ? computeZenithDistribution({scope,year,month,date},sources[0],config,progress=>self.postMessage({id,type:'progress',...progress}))
      : type==='night-catalog' ? summarizeNight(computeNight(date,sources,config),sources,config)
      : type==='month' ? computeMonth(year,month,sources,config)
      : computeYear(year,sources,config,progress=>self.postMessage({id,type:'progress',...progress}));
    self.postMessage({id,type:'result',result});
  } catch(error) {
    self.postMessage({id,type:'error',error:error.message || String(error)});
  }
};
