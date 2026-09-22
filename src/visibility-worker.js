import { computeYear, computeMonth, computeNight } from './astronomy.js';
import { summarizeNight } from './night-catalog.js';

self.onmessage = ({data}) => {
  const {id,type,year,month,date,sources,config}=data;
  try {
    if(!['year','month','night-catalog'].includes(type)) throw new Error('未知计算请求');
    const result=type==='night-catalog' ? summarizeNight(computeNight(date,sources,config),sources,config)
      : type==='month' ? computeMonth(year,month,sources,config)
      : computeYear(year,sources,config,progress=>self.postMessage({id,type:'progress',...progress}));
    self.postMessage({id,type:'result',result});
  } catch(error) {
    self.postMessage({id,type:'error',error:error.message || String(error)});
  }
};
