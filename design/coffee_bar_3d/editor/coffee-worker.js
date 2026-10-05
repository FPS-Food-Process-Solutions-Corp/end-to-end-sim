import {solveCoffeeFlow} from './coffee-solver.js';
self.onmessage=event=>{
  const {id,definition,request}=event.data;
  try {self.postMessage({id,result:solveCoffeeFlow(definition,request,progress=>self.postMessage({id,progress}))});}
  catch(error){self.postMessage({id,error:error.message});}
};
