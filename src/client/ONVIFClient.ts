import {linerase} from "./utils";
import {SOAP} from "./soap";
import {MediaClient} from "./MediaClient";
import {Media2Client} from "./Media2Client";
import {EventsClient} from "./EventsClient";
import url from "url";

export interface Config {
    username: string
    password: string
    baseURL: string
}

export class ONVIFClient {
    public media: MediaClient;
    public media2: Media2Client;
    public events: EventsClient;
    private readonly url: string;
    private readonly soap: SOAP
    constructor(config: Config) {
        const {username, password, baseURL} = config;
        const url = new URL(baseURL)
        url.pathname = 'onvif/device_service';
        this.url = url.toString();
        console.log('url', this.url);
        this.soap   = new SOAP({username, password, url: this.url});
        this.media  = new MediaClient(this.soap);
        this.media2 = new Media2Client(this.soap);
        this.events = new EventsClient(this.soap);
    }

    public async init() {
        await this.soap.getSystemTime();
        await this.getServices();
        // await this.getActiveSources();
    }

    public async getServices() {
        const body = `
            <GetServices xmlns="http://www.onvif.org/ver10/device/wsdl">
                <IncludeCapability>true</IncludeCapability>
            </GetServices>
            `
        const data = await this.soap.request(this.url, body);
        const services = linerase(data).getServicesResponse.service;
        await Promise.all(services.map(s => this.addService(s)));

        return services;
    }

    public async getCapabilities(): Promise<any> {
        const body = `
                <GetCapabilities xmlns="http://www.onvif.org/ver10/device/wsdl">
                    <Category>All</Category>
                </GetCapabilities>
                `
        const data = await this.soap.request(this.url, body)
        const capabilities = linerase(data[0]['getCapabilitiesResponse'][0]['capabilities'][0]);
        console.log('getCapabilities', capabilities);
        await Promise.all(Object.keys(capabilities).flatMap((key) =>
            key === 'extension'
                ? Object.keys(capabilities.extension).map(k => this.addCapability(k, capabilities.extension[k].XAddr))
                : this.addCapability(key, capabilities[key])
        ));
        return capabilities;
    };

    private async addCapability(code, url) {
        const workingURL = new URL(this.url);
        workingURL.pathname = new URL(url).pathname;
        if (code && this[code] && this[code].init) {
            await this[code].init(workingURL.toString());
        }
    }

    private async addService(service: {namespace: string, XAddr: string}) : Promise<void> {
        // Look for services with namespaces and XAddr values
        if (
            Object.prototype.hasOwnProperty.call(service,'namespace')
            && Object.prototype.hasOwnProperty.call(service,'XAddr')
        ) {
            // Only parse ONVIF namespaces. Axis cameras return Axis namespaces in GetServices
            let parsedNamespace = new URL(service.namespace);
            if (parsedNamespace.hostname === 'www.onvif.org') {
                const [version, code] = parsedNamespace.pathname.substring(1).split('/').concat(undefined); // remove leading Slash, then split
                // special case for Media and Media2 where cameras supporting Profile S and Profile T (2020/2021 models) have two media services
                const prop = (code == 'media' && version == 'ver20') ? 'media2' : code
                await this.addCapability(prop, service.XAddr);
            }
        }
    }
}