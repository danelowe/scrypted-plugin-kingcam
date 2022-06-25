# KingCam ONVIF Plugin for Scrypted

I've implemented a custom client that supports the minimum required ONVIF endpoints to get KingCam cameras set up with Scrypted. This is in `src/client`.

`common.ts` and `rtsp.ts` are extracted from Scrypted.

## publish

`npm publish --access public`

## Deploy to scrypted
`npm run build && npm run scrypted-deploy 192.168.1.100`

## Scrypted

Set up to make security cameras compatible with HomeKit Secure Video.

Install `@danelowe/scrypted-plugin-kingcam` plugin, `@scrypted/homekit` `@scrypted/snapshot`

The cameras should have motion detection enabled, and able to send ONVIF events to scrypted.

### Required docker config:
```dockerfile
FROM koush/scrypted:v0.1.6
RUN apt-get -y update
RUN apt-get install -y ffmpeg
```
```yaml
  scrypted:
    build: ./scrypted/
    privileged: true # this may not be necessary for all setups
    container_name: scrypted
    restart: always
    network_mode: host
    volumes:
        - ./volumes/scrypted:/server/volume
        # Adds `{ type: () => true }` to plain text body parser to allow XML or other non-JSON bodies to be posted.
        - ./scrypted/plugin-http.js:/server/node_modules/@scrypted/server/dist/plugin/plugin-http.js
    devices:
      - /dev/dri/renderD128 # for intel hwaccel
    environment:
      SCRYPTED_FFMPEG_PATH: /usr/bin/ffmpeg # Use OS package rather than node package, to support VAAPI hardware decoding.
    logging:
        driver: "json-file"
        options:
            max-size: "10m"
            max-file: "10"
```

### Scrypted setup for each camera

- Integrations, WebRTC (required), Rebroadcast, Transcoding, HomeKit, Snapshot.
- Disable audio. The cameras might actually support audio, but HKSV requires AAC (which may be supported by camera?), and we don't really want audio.
- HomeKit Tab - Transcoding Debug Mode.
- HomeKit Pairing - Standalone Accessory Mode.
- Transcoding - All streams: `-hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format yuv420p`
- Stream: MainStream, Stream: SubStream - set RTSP parser to FFMPEG TCP
- Snapshot: from prebuffer.

**Reload plugins to ensure cameras are no longer set up in bridge mode*

## Enable motion detection.

Motion detection is performed by the camera, and posted to scrypted.

Motion detection should be enabled on each camera. 

If you don't have Internet Explorer, the easiest method is telnet.

```
➜  onvif telnet 192.168.1.155 9999
Trying 192.168.1.155...
Connected to 192.168.1.155.
Escape character is '^]'.
list
[Success]list;accfg;aeawbblccfg;alarmincfg;alarmoutcfg;alarmtest;alarmhost;audiocfg;audiotestcfg;blackmargincfg;ca2aicfg;ca2host;ca2mdcfg;ca2vlcfg;ca2vmcfg;capturecfg;ca2ipconflict;ca2linkbroken;ca2diskfull;ca2diskerror;ddns9299;ddns3322;devrecordcfg;devvecfg;denoisecfg;emailcfg;ethcfg;ftpclicfg;getalarmevent;ircfg;mdcfg;mdmbcfg;nfsrecordcfg;osdcfg;osdstrcfg;osdstylecfg;portcfg;pppoecfg;roicfg;sambarecordcfg;searchfilecfg;getlog;sysctrl;timecfg;update;ntpcfg;upnpcfg;sdcard;userpasswd;veprofile;version;vicfg;vlcfg;toggle;videomaskcfg;capability;showweb;ptzcfg;checkuser;authmode;diskalarmcfg;vmaskalarmcfg;prienv;bootargs;guobiaocfg;guobiaoaddr;tslivecfg;hngscfg;jstarcfg;tutkcfg;format;mkdosfsprogbar;lensdpc;lenscs;danalecfg;danaleconf;dhcpnotify;outispadjust;

Connection closed by foreign host.
➜  onvif telnet 192.168.1.155 9999
Trying 192.168.1.155...
Connected to 192.168.1.155.
Escape character is '^]'.
mdmbcfg -act list
[Success]enable=1;thresh=100;mbdesc=0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,0000000000000000000000,;timestrategy=0:2164260863,1:2164260863,2:2164260863,3:2164260863,4:2164260863,5:2164260863,6:2164260863,;
```

```bash
➜  ~ telnet 192.168.1.155 9999
Trying 192.168.1.155...
Connected to 192.168.1.155.
Escape character is '^]'.
mdmbcfg -act list
[Success]enable=1;thresh=20;mbdesc=0000000000000000000000,0000000000000000000000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0111111111111111111000,0000000000000000000000,0000000000000000000000,0000000000000000000000,;timestrategy=0:2164260863,1:2164260863,2:2164260863,3:2164260863,4:2164260863,5:2164260863,6:2164260863,;
```

`thresh` is sensitivity threshold. 100 is most sensitive, 0 is least sensitive.

`mbdesc` is 18 sets of 22 bits. Presumably this is just splitting the screen into boxes, with `1` indicating that motion in that box should be detected.

```
0000000000000000000000,
0000000000000000000000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0111111111111111111000,
0000000000000000000000,
0000000000000000000000,
0000000000000000000000
```

`timestrategy` is the times that motion detection is enabled by day of week. `2164260863` is all day.

To enable motion detection at all time, in all areas of the camera, with a detection sensitivity of 20/100, run:

```
mdmbcfg -act set -enable 1 -thresh 20 -mbdesc 1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111,1111111111111111111111 -timestrategy 0:2164260863,1:2164260863,2:2164260863,3:2164260863,4:2164260863,5:2164260863,6:2164260863;
```