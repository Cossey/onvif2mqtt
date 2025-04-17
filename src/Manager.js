import _config from './Config';
import logger from './Logger';
import OnvifSubscriberGroup from './onvif/SubscriberGroup';
import MqttPublisher from './mqtt/Publisher';

import process from 'process';

import { CALLBACK_TYPES } from "./onvif/SubscriberGroup";
import {
  debounceMotionStateUpdate,
  debouncePeopleStateUpdate,
  debounceLineStateUpdate,
  debounceVehicleStateUpdate,
  debounceAnimalStateUpdate
} from "./utils/debounceStateUpdate";
import interpolateTemplateValues from './utils/interpolateTemplateValues';

const convertBooleanToSensorState = bool => bool ? 'ON' : 'OFF';

export default class Manager {
  constructor() {
    this.logger = logger.child({ name: 'Manager' });
    this.config = new _config(() => {
      this.initializeOnvifDevicesFunctions();
    });

    this.init();
  }

  init = async () => {
    this.logger.info('Beginning initialization...');

    this.publisher = new MqttPublisher(this.config.get('mqtt'));
    await this.publisher.connect();
    await this.publisher.publish_service_status('ON');

    this.subscriber = new OnvifSubscriberGroup();
    this.initializeOnvifDevicesFunctions();

    this.onExitSendStatus();
  };

  initializeOnvifDevicesFunctions = () => {
    this.subscriber.destroy();
    this.initializeOnvifDevices(this.config.get('onvif'));
    this.subscriber.withCallback(CALLBACK_TYPES.motion, this.onMotionDetected);
    this.subscriber.withCallback(CALLBACK_TYPES.people, this.onPeopleDetected); 
    this.subscriber.withCallback(CALLBACK_TYPES.line, this.onLineCrossed);
    this.subscriber.withCallback(CALLBACK_TYPES.vehicle, this.onVehicleDetected);
    this.subscriber.withCallback(CALLBACK_TYPES.animal, this.onAnimalDetected);
    this.subscriber.withCallback(CALLBACK_TYPES.tplink, this.onTplinkSmartEventDetected);
  };

  initializeOnvifDevices = devices => {
    devices.forEach(async (onvifDevice) => {
      const { name } = onvifDevice;

      await this.subscriber.addSubscriber(onvifDevice);

      this.onMotionDetected(name, false);
      this.onPeopleDetected(name, false);
      this.onLineCrossed(name, false);  
      this.onVehicleDetected(name, false);
      this.onAnimalDetected(name, false);
    });
  };

  publishTemplates = (onvifDeviceId, eventType, eventState) => {
    const templates = this.config.get('api.templates');

    if (!templates) {
      return;
    }

    templates.forEach(({
                         subtopic, template, retain
                       }) => {
      const interpolationValues = {
        onvifDeviceId,
        eventType,
        eventState
      };

      const interpolatedSubtopic = interpolateTemplateValues(subtopic, interpolationValues);
      const interpolatedTemplate = interpolateTemplateValues(template, interpolationValues);

      this.publisher.publish(onvifDeviceId, interpolatedSubtopic, interpolatedTemplate, retain);
    });
  };

  /* Event Callbacks */
  onMotionDetected = debounceMotionStateUpdate((onvifDeviceId, motionState) => {
    const topicKey = 'motion';
    const boolMotionState = motionState.IsMotion !== undefined ? motionState.IsMotion : motionState.State;

    this.publishTemplates(onvifDeviceId, topicKey, boolMotionState);
    this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolMotionState));
  });

  onPeopleDetected = debouncePeopleStateUpdate((onvifDeviceId, peopleState) => {
      const topicKey = 'people';
      const boolPeopleState = peopleState.IsPeople !== undefined ? peopleState.IsPeople : peopleState.State;

      this.publishTemplates(onvifDeviceId, topicKey, boolPeopleState);
      this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolPeopleState));
  });

  onLineCrossed = debounceLineStateUpdate((onvifDeviceId, lineCrossedState) => {
    const topicKey = 'line';
    const boolLineCrossedState = lineCrossedState.IsLineCross !== undefined ? lineCrossedState.IsLineCross : lineCrossedState.State;

    this.publishTemplates(onvifDeviceId, topicKey, boolLineCrossedState);
    this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolLineCrossedState));
  });

  onAnimalDetected = debounceAnimalStateUpdate((onvifDeviceId, animalState) => {
    const topicKey = 'animal';
    const boolAnimalState = animalState.IsPet !== undefined ? animalState.IsPet : animalState.State;

    this.publishTemplates(onvifDeviceId, topicKey, boolAnimalState);
    this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolAnimalState));
  });

  onVehicleDetected = debounceVehicleStateUpdate((onvifDeviceId, vehicleState) => {
    const topicKey = 'vehicle';
    const boolVehicleState = vehicleState.IsVehicle !== undefined ? vehicleState.IsVehicle : vehicleState.State;

    this.publishTemplates(onvifDeviceId, topicKey, boolVehicleState);
    this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolVehicleState));
  });

  onTplinkSmartEventDetected = (onvifDeviceId, tplinkSmartEventState) => {
    this.logger.trace(`Received TPSmartEventDetector for device ${onvifDeviceId}:`, tplinkSmartEventState);
    if (tplinkSmartEventState.IsVehicle !== undefined) {
      this.logger.trace(`Event is vehicle: ${tplinkSmartEventState.IsVehicle}`);
      this.onVehicleDetected(onvifDeviceId, tplinkSmartEventState);
    } else if (tplinkSmartEventState.IsPet !== undefined) {
      this.logger.trace(`Event is pet: ${tplinkSmartEventState.IsPet}`);
      this.onAnimalDetected(onvifDeviceId, tplinkSmartEventState);
    } else {
      this.logger.warn(`Unknown TPSmartEventDetector received for device ${onvifDeviceId}:`, tplinkSmartEventState);
    }
  };

  onExitSendStatus = () => {
    process.on('SIGTERM', async () => {
      await this.publisher.publish_service_status('OFF');
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      await this.publisher.publish_service_status('OFF');
      process.exit(0);
    });

    process.on('beforeExit', async (code) => {
      await this.publisher.publish_service_status('OFF');
      process.exit(code);
    });
  };
}
