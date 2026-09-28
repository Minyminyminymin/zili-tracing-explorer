import {buildModel} from './analysis.mjs';
self.onmessage=e=>{try{self.postMessage({id:e.data.id,model:buildModel(e.data.rows,e.data.cfg)});}catch(err){self.postMessage({id:e.data.id,error:err.message});}};
