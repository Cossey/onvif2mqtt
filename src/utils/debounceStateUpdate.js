export const debounceMotionStateUpdate = eventCallback => {
  let currentMotionStates = {};

  return (onvifDeviceId, motionState) => {
    if (currentMotionStates[onvifDeviceId] === motionState) {
      return;
    }

    currentMotionStates[onvifDeviceId] = motionState;
    eventCallback(onvifDeviceId, motionState);
  };
};

export const debouncePeopleStateUpdate = eventCallback => {
  let currentPeopleStates = {};

  return (onvifDeviceId, peopleState) => {
    if (currentPeopleStates[onvifDeviceId] === peopleState) {
      return;
    }

    currentPeopleStates[onvifDeviceId] = peopleState;
    eventCallback(onvifDeviceId, peopleState);
  };
};

export const debounceLineStateUpdate = eventCallback => {
  let currentLineStates = {};

  return (onvifDeviceId, lineState) => {
    if (currentLineStates[onvifDeviceId] === lineState) {
      return;
    }

    currentLineStates[onvifDeviceId] = lineState;
    eventCallback(onvifDeviceId, lineState);
  };
};