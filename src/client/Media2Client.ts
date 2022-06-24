import {SOAP} from "./soap";

export class Media2Client {
    private url: string

    constructor(private soap: SOAP) {}

    public init(url: string) {
        this.url = url;
    }
}