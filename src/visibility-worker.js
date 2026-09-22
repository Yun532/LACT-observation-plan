import { computeYear, computeMonth } from './astronomy.js';

self.onmessage = ({data}) => {
  const {id,type,year,month,sources,config}=data;
  try {
    if(!['year','month'].includes(type)) throw new Error('未知计算请求');
    const result=type==='month' ? computeMonth(year,month,sources,config) : computeYear(year,sources,config,progress=>self.postMessage({id,type:'progress',...progress}));
    self.postMessage({id,type:'result',result});
  } catch(error) {
    self.postMessage({id,type:'error',error:error.message || String(error)});
  }
};
