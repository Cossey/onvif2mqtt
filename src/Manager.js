import _config from './Config';
import logger from './Logger';
import OnvifSubscriberGroup from './onvif/SubscriberGroup';
import MqttPublisher from './mqtt/Publisher';

import process from 'process';

import { CALLBACK_TYPES } from "./onvif/SubscriberGroup";
import debounceStateUpdate from "./utils/debounceStateUpdate";
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
    this.subscriber.withCallback(CALLBACK_TYPES.people, this.onPeopleDetected); // Register the new callback
  };

  initializeOnvifDevices = devices => {
    devices.forEach(async (onvifDevice) => {
      const { name } = onvifDevice;

      await this.subscriber.addSubscriber(onvifDevice);

      this.onMotionDetected(name, false);
      this.onPeopleDetected(name, false); // Initialize people detection state
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
  onMotionDetected = debounceStateUpdate((onvifDeviceId, motionState) => {
    const topicKey = 'motion';
    const boolMotionState = motionState.IsMotion !== undefined ? motionState.IsMotion : motionState.State;

    this.publishTemplates(onvifDeviceId, topicKey, boolMotionState);
    this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolMotionState));
  });

  onPeopleDetected = debounceStateUpdate((onvifDeviceId, peopleState) => {
    try {

      const topicKey = 'people';
      const boolPeopleState = peopleState.IsPeople !== undefined ? peopleState.IsPeople : peopleState.State;

      this.publishTemplates(onvifDeviceId, topicKey, boolPeopleState);
      this.publisher.publish(onvifDeviceId, topicKey, convertBooleanToSensorState(boolPeopleState));
    } catch (error) {
      this.logger.error(`Error in onPeopleDetected for device ${onvifDeviceId}:`, error); // Log the error if one occurs
    }
  });

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
