import {SOAP} from "./soap";
import {linerase, parseSOAPString} from "./utils";

interface Config {
    binaryStateEvent?: string
}

export class EventsClient {
    private url: string
    private subscriptions: {[url: string]: NodeJS.Timer} = {}
    private detections?: {[name: string]: string}
    private motionListener?: (hasMotion: boolean) => void;
    private audioListener?: (hasAudio: boolean) => void;
    private binaryListener?: (value: boolean) => void;
    private objectListener?: (className: string) => void;
    private ringListenr?: () => void;
    constructor(private soap: SOAP, private config: Config) {}

    public init(url: string) {
        this.url = url;
    }

    public isSupported() {
        return !!this.url;
    }

    public async createSubscription(url: string) {
        clearInterval(this.subscriptions[url]);
        const header = `<a:ReplyTo><a:Address>${url}</a:Address></a:ReplyTo>`;
        const body = `
        <Subscribe xmlns="http://docs.oasis-open.org/wsn/b-2">
            <ConsumerReference><a:Address>${url}</a:Address></ConsumerReference>
            <InitialTerminationTime>PT60M</InitialTerminationTime>
        </Subscribe>
    `
        await this.soap.request(this.url, body, {header})
        this.subscriptions[url] = setInterval(() => this.renewSubscription(url), 30 * 60 * 1000)
    }

    public async getEventProperties(): Promise<any> {
        const body = '<GetEventProperties xmlns="http://www.onvif.org/ver10/events/wsdl"/>'
        const data = await this.soap.request(this.url, body).then(linerase)
        return data.getEventPropertiesResponse;
    };

    async getEventTypes(): Promise<string[]> {
        if (!this.detections) {
            const properties = await this.getEventProperties()
            this.detections = {};
            try {
                for (const [className, entry] of Object.entries(properties.topicSet.ruleEngine.objectDetector) as any) {
                    try {
                        const eventName = entry.messageDescription.data.simpleItemDescription.$.Name;
                        this.detections[eventName] = className;
                    } catch (e) {
                    }
                }
            }
            catch (e) {
            }
        }
        return [...Object.values(this.detections)];
    }

    public async parseEvent(xml: string): Promise<void> {
        const data = await parseSOAPString(xml).then(linerase);
        const event = data.notify.notificationMessage;
        const topic = stripNamespaces(event.topic._)
        const name = event.message.message.data.simpleItem.$.Name;
        const value = event.message.message.data.simpleItem.$.Value;
        if (event.message.message.data && event.message.message.data.simpleItem) {
            this.notifiyEvent({topic, name, value})
        }
    }

    public onMotion(callback: (hasMotion: boolean) => void) {
        this.motionListener = callback;
    }

    public onAudio(callback: (hasAudio: boolean) => void) {
        this.audioListener = callback;
    }

    public onRing(callback: () => void) {
        this.ringListenr = callback;
    }

    public onBinary(callback: (value: boolean) => void) {
        this.binaryListener = callback;
    }

    public onObjectDetection(callback: (className: string) => void) {
        this.objectListener = callback;
    }

    private async renewSubscription(url: string) {
        await this.createSubscription(url);
    }

    private notifiyEvent({topic, name, value}: {topic: string, name: string, value: any}) {
        if (this.motionListener && topic.includes('MotionAlarm')) {
            return this.motionListener(value);
        } else if (this.audioListener && topic.includes('DetectedSound')) {
            return this.audioListener(value);
        } else if (this.ringListenr && topic.includes('VideoSource/Alarm') && (value == "Ring" || value == "CameraBellButton")) {
            // mobotix t26
            return this.ringListenr();
        } else if (this.binaryListener && this.config.binaryStateEvent && topic.includes(this.config.binaryStateEvent)) {
            return this.binaryListener(value);
        } else if (this.motionListener &&  topic.includes('RuleEngine/CellMotionDetector/Motion') && name === 'IsMotion') {
            return this.motionListener(value)
        } else if (this.objectListener && topic.includes('RuleEngine/ObjectDetector') && value && this.detections[name]) {
            this.objectListener(this.detections[name])
        }
    }
}

function stripNamespaces(topic: string) {
    // example input :-   tns1:MediaControl/tnsavg:ConfigurationUpdateAudioEncCfg
    // Split on '/'
    // For each part, remove any namespace
    // Recombine parts that were split with '/'
    let output = '';
    let parts = topic.split('/')
    for (let index = 0; index < parts.length; index++) {
        let stringNoNamespace = parts[index].split(':').pop() // split on :, then return the last item in the array
        if (output.length == 0) {
            output += stringNoNamespace
        } else {
            output += '/' + stringNoNamespace
        }
    }
    return output
}