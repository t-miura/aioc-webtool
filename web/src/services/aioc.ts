
export const AIOC_VID = 0x1209;
export const AIOC_PID = 0x7388;

export enum Register {
  MAGIC = 0x00,
  USBID = 0x08,
  AIOC_IOMUX0 = 0x24,
  AIOC_IOMUX1 = 0x25,
  CM108_IOMUX0 = 0x44,
  CM108_IOMUX1 = 0x45,
  CM108_IOMUX2 = 0x46,
  CM108_IOMUX3 = 0x47,
  SERIAL_CTRL = 0x60,
  SERIAL_IOMUX0 = 0x64,
  SERIAL_IOMUX1 = 0x65,
  SERIAL_IOMUX2 = 0x66,
  SERIAL_IOMUX3 = 0x67,
  AUDIO_RX = 0x72,
  AUDIO_TX = 0x78,
  VPTT_LVLCTRL = 0x82,
  VPTT_TIMCTRL = 0x84,
  VCOS_LVLCTRL = 0x92,
  VCOS_TIMCTRL = 0x94,
  FOXHUNT_CTRL = 0xA0,
  FOXHUNT_MSG0 = 0xA2,
  FOXHUNT_MSG1 = 0xA3,
  FOXHUNT_MSG2 = 0xA4,
  FOXHUNT_MSG3 = 0xA5,
}

export const REGISTER_DEFAULTS: Record<Register, number> = {
  [Register.MAGIC]: 0x434f4941,
  [Register.USBID]: 0x73881209,
  [Register.AIOC_IOMUX0]: 0x00000404,
  [Register.AIOC_IOMUX1]: 0x00000008,
  [Register.CM108_IOMUX0]: 0x00020000,
  [Register.CM108_IOMUX1]: 0x01000000,
  [Register.CM108_IOMUX2]: 0x00000000,
  [Register.CM108_IOMUX3]: 0x00000000,
  [Register.SERIAL_CTRL]: 0x00010100,
  [Register.SERIAL_IOMUX0]: 0x01000000,
  [Register.SERIAL_IOMUX1]: 0x00000000,
  [Register.SERIAL_IOMUX2]: 0x00000000,
  [Register.SERIAL_IOMUX3]: 0x00000000,
  [Register.AUDIO_RX]: 0x00000000,
  [Register.AUDIO_TX]: 0x00000000,
  [Register.VPTT_LVLCTRL]: 0x00000010,
  [Register.VPTT_TIMCTRL]: 0x00000140,
  [Register.VCOS_LVLCTRL]: 0x00000100,
  [Register.VCOS_TIMCTRL]: 0x00000c80,
  [Register.FOXHUNT_CTRL]: 0x80001400,
  [Register.FOXHUNT_MSG0]: 0x00000000,
  [Register.FOXHUNT_MSG1]: 0x00000000,
  [Register.FOXHUNT_MSG2]: 0x00000000,
  [Register.FOXHUNT_MSG3]: 0x00000000,
};

export enum Command {
  NONE = 0x00,
  WRITESTROBE = 0x01,
  DEFAULTS = 0x10,
  REBOOT = 0x20,
  RECALL = 0x40,
  STORE = 0x80,
}

export enum PTTSource {
  NONE = 0x00000000,
  CM108GPIO1 = 0x00000001,
  CM108GPIO2 = 0x00000002,
  CM108GPIO3 = 0x00000004,
  CM108GPIO4 = 0x00000008,
  SERIALDTR = 0x00000100,
  SERIALRTS = 0x00000200,
  SERIALDTRNRTS = 0x00000400,
  SERIALNDTRRTS = 0x00000800,
  VPTT = 0x00001000,
}

export enum ButtonSource {
  NONE = 0x00000000,
  IN1 = 0x00010000,
  IN2 = 0x00020000,
  VCOS = 0x01000000,
}

export enum RXGain {
  RXGAIN1X = 0x00000000,
  RXGAIN2X = 0x00000001,
  RXGAIN4X = 0x00000002,
  RXGAIN8X = 0x00000003,
  RXGAIN16X = 0x00000004,
}

export enum TXBoost {
  OFF = 0x00000000,
  ON = 0x00000100,
}

export class AIOCDevice {
  private device: HIDDevice;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  async open() {
    if (!this.device.opened) {
      await this.device.open();
    }
  }

  async close() {
    if (this.device.opened) {
      await this.device.close();
    }
  }

  async read(address: Register): Promise<number> {
    const data = new Uint8Array(6);
    data[0] = Command.NONE;
    data[1] = address;
    
    await this.device.sendFeatureReport(0, data);
    const report = await this.device.receiveFeatureReport(0);
    
    const view = new DataView(report.buffer);
    if (report.byteLength === 6) {
        return view.getUint32(2, true);
    } else if (report.byteLength === 7) {
        return view.getUint32(3, true);
    }
    throw new Error(`Unexpected report length: ${report.byteLength}`);
  }

  async write(address: Register, value: number): Promise<void> {
    const data = new Uint8Array(6);
    data[0] = Command.WRITESTROBE;
    data[1] = address;
    const view = new DataView(data.buffer);
    view.setUint32(2, value, true);
    
    await this.device.sendFeatureReport(0, data);
  }

  async sendCommand(cmd: Command): Promise<void> {
    const data = new Uint8Array(6);
    data[0] = cmd;
    data[1] = 0;
    await this.device.sendFeatureReport(0, data);
  }
  
  get productName() {
      return this.device.productName;
  }
}

export async function requestAIOC(): Promise<AIOCDevice | null> {
    const devices = await navigator.hid.requestDevice({
        filters: [{ vendorId: AIOC_VID, productId: AIOC_PID }]
    });
    
    if (devices.length > 0) {
        return new AIOCDevice(devices[0]);
    }
    return null;
}
