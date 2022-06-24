import fetch from "node-fetch";
import {linerase, parseSOAPString} from "./utils";
import crypto from "crypto";


interface RequestOptions {
    auth?: boolean;
    header?: string;
}

interface Config {
    username: string;
    password: string;
    url: string;
}


export class SOAP {
    private timeShift = 0;
    constructor(private config: Config) {
    }

    public async request<T>(url: string, body: string, {header, auth}: RequestOptions = {}) : Promise<T> {
        console.log('fetch', url, body);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/soap+xml',
                'Content-Length': Buffer.byteLength(body, 'utf8').toString(10), //options.body.length chinese will be wrong here
                'charset': 'utf-8',
            },
            body: this.envelope(body, {header, auth}),
        })
        const xml = await response.text();
        if (response.status >= 200 && response.status < 300) {
            return await parseSOAPString(xml) as unknown as T;
        } else {
            throw new Error(`Invalid response code: ${response.status} - ${xml}`)
        }
    }

    public async getSystemTime() {
        const data = await this.request(this.config.url, '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>', {auth: false});
        let systemDateAndTime = data[0]['getSystemDateAndTimeResponse'][0]['systemDateAndTime'][0];
        let dateTime = systemDateAndTime['UTCDateTime'] || systemDateAndTime['localDateTime'];
        let time;
        if (dateTime == undefined) {
            // Seen on a cheap Chinese camera from GWellTimes-IPC. Use the current time.
            time = new Date();
        } else {
            let dt = linerase(dateTime[0]);
            time = new Date(Date.UTC(dt.date.year, dt.date.month - 1, dt.date.day, dt.time.hour, dt.time.minute, dt.time.second));
        }
        this.timeShift = time - (process.uptime() * 1000);
    }

    private envelope(body: string, {header, auth}: RequestOptions = {auth: true}) : string {
        const authHeader = auth === false ? '' : `<s:Header>${this.securityHeader}</s:Header>`
        return `
        <s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
            ${authHeader}
            ${header}
            <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
                ${body}
            </s:Body>
        </s:Envelope>
        `.trim()
    }

    private get securityHeader() : string {
        if (this.config.username && this.config.password) {
            const {passdigest, timestamp, nonce} = this.passwordDigest();
            return `
            <Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
                <UsernameToken>
                    <Username>${this.config.username}</Username>
                    <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${passdigest}</Password>
                    <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce}</Nonce>
                    <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${timestamp}</Created>
                </UsernameToken>
            </Security>
            `.trim()
        }
    }

    private passwordDigest() {
        let timestamp = (new Date((process.uptime() * 1000) + (this.timeShift || 0))).toISOString()
        console.log('timestamp', timestamp);
        let nonce = Buffer.allocUnsafe(16)
        nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 0, 4)
        nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 4, 4)
        nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 8, 4)
        nonce.writeUIntLE(Math.ceil(Math.random() * 0x100000000), 12, 4)
        let cryptoDigest = crypto.createHash('sha1')
        cryptoDigest.update(Buffer.concat([nonce, Buffer.from(timestamp, 'ascii'), Buffer.from(this.config.password, 'ascii')]))
        let passdigest = cryptoDigest.digest('base64')
        return {passdigest, timestamp, nonce: nonce.toString('base64')}
    };

}