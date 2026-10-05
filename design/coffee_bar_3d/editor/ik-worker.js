import {checkBreadWorkflow, combineBreadWorkflow} from './bread-flow.js';
import {checkWorkflow} from './ik-core.js';
import {applyNovaPairCheck} from './nova-pair-collision.js';
import {recoverNovaPair} from './nova-pair-recovery.js';

let definition, breadDefinition;
self.onmessage = async event => {
  const {id, request} = event.data;
  try {
    definition ||= await fetch('../robot-library/nova5_suction-kinematics.json').then(response => {
      if (!response.ok) throw new Error('Could not load Nova-5 kinematics.');
      return response.json();
    });
    let result = checkWorkflow(definition, request, progress => self.postMessage({id, progress}));
    if (request.breadTask) {
      breadDefinition ||= await fetch('../robot-library/nova5_bread-kinematics.json').then(r => {if (!r.ok) throw new Error('Could not load tong kinematics.'); return r.json();});
      combineBreadWorkflow(result, checkBreadWorkflow(breadDefinition, request.breadTask, progress => self.postMessage({id, progress})),request.settings);
    }
    result=recoverNovaPair(definition,request,result,progress=>self.postMessage({id,progress}));
    applyNovaPairCheck(request,result,progress=>self.postMessage({id,progress}));
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: error.message});
  }
};
