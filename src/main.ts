import sdk, {
    MediaObject,
    ScryptedInterface,
    Setting,
    ScryptedDeviceType,
    PictureOptions,
    VideoCamera,
    DeviceDiscovery,
    ObjectDetector,
    ObjectDetectionTypes,
    Settings,
    SettingValue,
    HttpRequestHandler,
    HttpRequest,
    HttpResponse,
} from "@scrypted/sdk";
import {EventEmitter, Stream} from "stream";
import xml2js from 'xml2js';
import onvif from 'onvif'; // @todo: replace this dependency with ONVIFClient?
import {ONVIFClient} from "./client/ONVIFClient";
import {Destroyable, RtspProvider, RtspSmartCamera} from "./rtsp";
import {UrlMediaStreamOptions} from "./common";

const {systemManager, deviceManager, endpointManager} = sdk;

function computeInterval(fps: number, govLength: number) {
    if (!fps || !govLength)
        return;
    return govLength / fps * 1000;
}

function computeBitrate(bitrate: number) {
    if (!bitrate)
        return;
    return bitrate * 1000;
}

function convertAudioCodec(codec: string) {
    if (codec?.toLowerCase()?.includes('mp4a'))
        return 'aac';
    if (codec?.toLowerCase()?.includes('aac'))
        return 'aac';
    return codec?.toLowerCase();
}

class OnvifCamera extends RtspSmartCamera implements ObjectDetector, HttpRequestHandler {
    eventStream: Stream;
    rtspMediaStreamOptions: Promise<UrlMediaStreamOptions[]>;
    motionTimeout?: NodeJS.Timeout;
    private onvifClient: ONVIFClient;

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        try {
            const client = await this.getONVIFClient();
            await client.events.parseEvent(request.body);
        } catch (e) {
            this.console.error(e);
        }
        response.send('');
    }

    getDetectionInput(detectionId: any, eventId?: any): Promise<MediaObject> {
        throw new Error("Method not implemented.");
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        const client = await this.getONVIFClient();
        return {classes: await client.events.getEventTypes()}
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        try {
            const vsos = await this.getVideoStreamOptions();
            const ret = vsos.map(({ id, name, video }) => ({
                id,
                name,
                // onvif doesn't actually specify the snapshot dimensions for a profile.
                // it may just send whatever.
                picture: {
                    width: video?.width,
                    height: video?.height,
                }
            }));
            return ret;
        }
        catch (e) {
        }
    }

    async takeSmartCameraPicture(options?: PictureOptions): Promise<MediaObject> {
        let id = options?.id;

        if (!id) {
            const vsos = await this.getVideoStreamOptions();
            const vso = this.getDefaultStream(vsos);
            id = vso?.id;
        }

        // KingCam's ONVIF-supplied endpoint for snapshots doesn't work. Just use the prebuffer stream.

        const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
        return realDevice.getVideoStream({
            id,
        });

        // todo: this is bad. just disable camera interface altogether.
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (!this.rtspMediaStreamOptions) {
            this.rtspMediaStreamOptions = new Promise(async (resolve) => {
                try {
                    const client = await this.getONVIFClient();
                    const profiles: any[] = await client.media.getProfiles();
                    const ret: UrlMediaStreamOptions[] = [];
                    for (const { $, name, videoEncoderConfiguration, audioEncoderConfiguration } of profiles) {
                        try {
                            ret.push({
                                id: $.token,
                                name: name,
                                container: 'rtsp',
                                url: await client.media.getStreamURL($.token),
                                video: {
                                    fps: videoEncoderConfiguration?.rateControl?.frameRateLimit,
                                    bitrate: computeBitrate(videoEncoderConfiguration?.rateControl?.bitrateLimit),
                                    width: videoEncoderConfiguration?.resolution?.width,
                                    height: videoEncoderConfiguration?.resolution?.height,
                                    codec: videoEncoderConfiguration?.encoding?.toLowerCase(),
                                    idrIntervalMillis: computeInterval(videoEncoderConfiguration?.rateControl?.frameRateLimit,
                                        videoEncoderConfiguration?.$.GovLength),
                                },
                                audio: this.isAudioDisabled() ? null : {
                                    bitrate: computeBitrate(audioEncoderConfiguration?.bitrate),
                                    codec: convertAudioCodec(audioEncoderConfiguration?.encoding),
                                }
                            })
                        }
                        catch (e) {
                            this.console.error('error retrieving onvif profile', $.token, e);
                        }
                    }

                    if (!ret.length)
                        throw new Error('onvif camera had no profiles.');

                    resolve(ret);
                }
                catch (e) {
                    this.rtspMediaStreamOptions = undefined;
                    this.console.error('error retrieving onvif profiles', e);
                    resolve(undefined);
                }
            })
        }

        return this.rtspMediaStreamOptions;
    }


    listenEvents(): EventEmitter & Destroyable {
        const ret: any = new EventEmitter();
        (async () => {
            const client = await this.getONVIFClient();
            if (!client.events.isSupported()) {
                return;
            }

            try {
                const eventTypes = await client.events.getEventTypes();
                if (eventTypes?.length && this.storage.getItem('onvifDetector') !== 'true') {
                    this.storage.setItem('onvifDetector', 'true');
                    this.updateDevice();
                }
            }
            catch (e) {
            }
            const url = await endpointManager.getInsecurePublicLocalEndpoint(this.nativeId);
            try {
                await client.events.createSubscription(url);
                client.events.onMotion((hasMotion) => this.motionDetected = hasMotion);
                console.log(`created subscription at ${url}`);
            }
            catch (e) {
                ret.emit('error', e);
                return;
            }
        })();
        ret.destroy = () => {
        };
        return ret;
    }

    async getONVIFClient() {
        if (!this.onvifClient) {
            const scheme = 'http://';
            this.onvifClient = new ONVIFClient({baseURL: scheme + this.getHttpAddress(), username: this.getUsername(), password: this.getPassword()})
            await this.onvifClient.init();
        }
        return this.onvifClient;

    }

    showRtspUrlOverride() {
        return false;
    }

    showRtspPortOverride() {
        return false;
    }

    showHttpPortOverride() {
        return true;
    }

    showSnapshotUrlOverride() {
        return false;
    }

    async getOtherSettings(): Promise<Setting[]> {
        const isDoorbell = !!this.providedInterfaces?.includes(ScryptedInterface.BinarySensor);

        const ret: Setting[] = [
            ...await super.getOtherSettings(),
            {
                title: 'Onvif Doorbell',
                type: 'boolean',
                description: 'Enable if this device is a doorbell',
                key: 'onvifDoorbell',
                value: isDoorbell.toString(),
            },
            {
                title: 'Onvif Doorbell Event Name',
                type: 'string',
                description: 'Onvif event name to trigger the doorbell',
                key: "onvifDoorbellEvent",
                value: this.storage.getItem('onvifDoorbellEvent'),
                placeholder: 'EventName'
            },
        ];

        if (!isDoorbell) {
            ret.push(
                {
                    title: 'Two Way Audio',
                    type: 'boolean',
                    key: 'onvifTwoWay',
                    value: (!!this.providedInterfaces?.includes(ScryptedInterface.Intercom)).toString(),
                }
            )
        }

        return ret;
    }

    updateDevice() {
        const interfaces: string[] = [...this.provider.getInterfaces()];
        if (this.storage.getItem('onvifDetector') === 'true')
            interfaces.push(ScryptedInterface.ObjectDetector);
        const doorbell = this.storage.getItem('onvifDoorbell') === 'true';
        let type: ScryptedDeviceType;
        if (doorbell) {
            interfaces.push(ScryptedInterface.BinarySensor);
            type = ScryptedDeviceType.Doorbell;
        }

        const twoWay = this.storage.getItem('onvifTwoWay') === 'true';
        if (twoWay || doorbell)
            interfaces.push(ScryptedInterface.Intercom);

        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async putSetting(key: string, value: string) {
        this.rtspMediaStreamOptions = undefined;

        if (key !== 'onvifDoorbell' && key !== 'onvifTwoWay')
            return super.putSetting(key, value);

        this.storage.setItem(key, value);
        this.updateDevice();
    }
}

class OnvifProvider extends RtspProvider implements DeviceDiscovery, Settings {

    constructor(nativeId?: string) {
        super(nativeId);

        this.discoverDevices(10000);

        onvif.Discovery.on('device', (cam: any, rinfo: any, xml: any) => {
            console.log('discovery', xml);
            // Function will be called as soon as the NVT responses

            // Parsing of Discovery responses taken from my ONVIF-Audit project, part of the 2018 ONVIF Open Source Challenge
            // Filter out xml name spaces
            xml = xml.replace(/xmlns([^=]*?)=(".*?")/g, '');

            let parser = new xml2js.Parser({
                attrkey: 'attr',
                charkey: 'payload',                // this ensures the payload is called .payload regardless of whether the XML Tags have Attributes or not
                explicitCharkey: true,
                tagNameProcessors: [xml2js.processors.stripPrefix]   // strip namespace eg tt:Data -> Data
            });
            parser.parseString(xml,
                async (err: Error, result: any) => {
                    if (err) {
                        this.console.error('discovery error', err);
                        return;
                    }
                    const urn = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['EndpointReference'][0]['Address'][0].payload;
                    const xaddrs = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['XAddrs'][0].payload;
                    let name: string;

                    try {
                        let scopes = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['Scopes'][0].payload;
                        scopes = scopes.split(" ");

                        for (let i = 0; i < scopes.length; i++) {
                            if (scopes[i].includes('onvif://www.onvif.org/name')) { name = decodeURI(scopes[i].substring(27)); }
                        }
                    }
                    catch (e) {
                    }

                    this.console.log('Discovery Reply from ' + rinfo.address + ' (' + name + ') (' + xaddrs + ') (' + urn + ')');

                    const isNew = !deviceManager.getNativeIds().includes(urn);
                    if (!isNew)
                        return;

                    await deviceManager.onDeviceDiscovered({
                        name,
                        nativeId: urn,
                        type: ScryptedDeviceType.Camera,
                        interfaces: this.getInterfaces(),
                    });
                    const device = await this.getDevice(urn) as OnvifCamera;
                    const onvifUrl = new URL(xaddrs)
                    device.setIPAddress(rinfo.address);
                    device.setHttpPortOverride(onvifUrl.port);
                    this.log.a('Discovered ONVIF Camera. Complete setup by providing login credentials.');
                }
            );
        })
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (key === 'autodiscovery') {
            this.storage.setItem(key, value.toString());
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            return;
        }
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Autodiscovery',
                description: 'Autodiscover ONVIF devices on the network',
                key: 'autodiscovery',
                type: 'boolean',
                value: this.storage.getItem('autodiscovery') !== 'false',
            }
        ]
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.HttpRequestHandler,
        ];
    }

    createCamera(nativeId: string): OnvifCamera {
        return new OnvifCamera(nativeId, this);
    }

    async discoverDevices(duration: number) {
        const autodiscovery = this.storage.getItem('autodiscovery') !== "false";
        if (!autodiscovery)
            return;

        onvif.Discovery.probe();
    }
}

export default new OnvifProvider();
