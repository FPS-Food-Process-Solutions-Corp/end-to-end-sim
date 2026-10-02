import {checkWorkflow} from './ik-core.js';

let definition;
self.onmessage = async event => {
  const {id, request} = event.data;
  try {
    definition ||= await fetch('../robot-library/nova5_suction-kinematics.json').then(response => {
      if (!response.ok) throw new Error('Could not load Nova-5 kinematics.');
      return response.json();
    });
    const result = checkWorkflow(definition, request, progress => self.postMessage({id, progress}));
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: error.message});
  }
};
