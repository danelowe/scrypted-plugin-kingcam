import {SOAP} from "./soap";
import {linerase} from "./utils";

export class MediaClient {
    constructor(private soap: SOAP) {}

    private profiles: any;
    private capabilities: any[];
    private videoSources: any[];
    private activeSources: any[];
    private rtspUrls: {[token: string]: string} = {};
    private url;

    public async init(url: string) {
        this.url = url;
        await Promise.all([
            this.getProfiles(),
            this.getVideoSources(),
        ])
        await this.getActiveSources();
    }

    public async getCapabilities() : Promise<string[]> {
        if (!this.capabilities) {
            const body = '<GetServiceCapabilities xmlns="http://www.onvif.org/ver10/media/wsdl" />'
            const data = await this.soap.request(this.url, body)
            this.capabilities = linerase(data[0].getServiceCapabilitiesResponse[0].capabilities);
        }
        return this.capabilities;
    }

    public async getSnapshotURI(profileToken?: string) : Promise<string> {
        const body = `
            <GetSnapshotUri xmlns="http://www.onvif.org/ver10/media/wsdl">
                <ProfileToken>${profileToken || this.activeSources[0].profileToken}</ProfileToken>
            </GetSnapshotUri>
            `
        const data = await this.soap.request(this.url, body)
        return linerase(data).getSnapshotUriResponse.mediaUri;
    }


    async getStreamURL(profileToken?: string): Promise<string> {
        if (!profileToken) {
            profileToken = await this.getMainProfileToken();
        }
        if (!this.rtspUrls[profileToken]) {
            const result = await this.getStreamURI({ protocol: 'RTSP', profileToken });
            this.rtspUrls[profileToken] = result.uri;
        }
        return this.rtspUrls[profileToken];
    }

    async getStreamURI(options: {stream?: string, protocol?: string, profileToken?: string}): Promise<any> {
        const body = `
            <GetStreamUri xmlns="http://www.onvif.org/ver10/media/wsdl">
                <StreamSetup>
                    <Stream xmlns="http://www.onvif.org/ver10/schema">${options.stream || 'RTP-Unicast'}</Stream>
                    <Transport xmlns="http://www.onvif.org/ver10/schema">
                        <Protocol>${options.protocol || 'RTSP'}</Protocol>
                    </Transport>
                </StreamSetup>
                <ProfileToken>${options.profileToken || this.activeSources[0].profileToken }</ProfileToken>
            </GetStreamUri>
        `
        const data = await this.soap.request(this.url, body)
        return linerase(data).getStreamUriResponse.mediaUri;
    }

    public async getProfiles() : Promise<any> {
        if (!this.profiles) {
            const body = '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>'
            const data = await this.soap.request(this.url, body)
            this.profiles = data[0]['getProfilesResponse'][0]['profiles'].map(linerase);
        }
        return this.profiles;
    };

    async getMainProfileToken() {
        const profiles = await this.getProfiles();
        const { token } = profiles[0].$;
        return token;
    }

    public async getVideoSources() : Promise<any[]> {
        if (!this.videoSources) {
            const body = '<GetVideoSources xmlns="http://www.onvif.org/ver10/media/wsdl"/>'
            const data = await this.soap.request(this.url, body)
            this.videoSources = linerase(data).getVideoSourcesResponse.videoSources;
            if (!Array.isArray(this.videoSources)) {this.videoSources = [this.videoSources];}
        }
        return this.videoSources;
    };

    public getActiveSources() {
        //NVT is a camera with one video source
        if ((this.videoSources as any).$) {
            this.videoSources = [this.videoSources];
        }
        this.activeSources = [];
        this.videoSources.forEach(function(videoSource, idx) {
            // let's choose first appropriate profile for our video source and make it default
            const videoSrcToken = videoSource.$.token
            const appropriateProfiles = this.profiles.filter((profile) =>
                    profile.videoSourceConfiguration
                    && (profile.videoSourceConfiguration.sourceToken === videoSrcToken)
                    && (profile.videoEncoderConfiguration)
            );
            if (appropriateProfiles.length === 0) {
                if (idx === 0) {
                    throw new Error('Unrecognized configuration');
                } else {
                    return;
                }
            }

            const profile = appropriateProfiles[0];

            this.activeSources[idx] = {
                sourceToken: videoSource.$.token,
                profileToken: profile.$.token,
                videoSourceConfigurationToken: profile.videoSourceConfiguration.$.token
            };
            if (profile.videoEncoderConfiguration) {
                var configuration = profile.videoEncoderConfiguration;
                this.activeSources[idx].encoding = configuration.encoding;
                this.activeSources[idx].width = configuration.resolution ? configuration.resolution.width : "";
                this.activeSources[idx].height = configuration.resolution ? configuration.resolution.height : "";
                this.activeSources[idx].fps = configuration.rateControl ? configuration.rateControl.frameRateLimit : "";
                this.activeSources[idx].bitrate = configuration.rateControl ? configuration.rateControl.bitrateLimit : "";
            }

            if (profile.PTZConfiguration) {
                this.activeSources[idx].ptz = {
                    name: profile.PTZConfiguration.name,
                    token: profile.PTZConfiguration.$.token
                };
            }
        }.bind(this));
    }
}