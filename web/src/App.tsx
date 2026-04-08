
import { useState, useMemo } from 'react';
import { 
  requestAIOC, 
  AIOCDevice, 
  Register, 
  Command, 
  REGISTER_DEFAULTS,
  PTTSource,
  ButtonSource,
  RXGain,
  TXBoost
} from './services/aioc';
import { TRANSLATIONS } from './translations';
import type { Language } from './translations';

type RegisterValues = Partial<Record<Register, number>>;

const PRESETS = (t: any) => ({
  [t.presetDefault]: REGISTER_DEFAULTS,
  [t.presetAPRS]: {
    ...REGISTER_DEFAULTS,
    [Register.AIOC_IOMUX0]: PTTSource.VPTT,
  },
  [t.presetVara]: {
    ...REGISTER_DEFAULTS,
    [Register.AIOC_IOMUX0]: PTTSource.CM108GPIO3 | PTTSource.SERIALDTRNRTS,
  },
  [t.presetASL3]: {
    ...REGISTER_DEFAULTS,
    [Register.VCOS_TIMCTRL]: 1.5 * 16000,
  }
});

function App() {
  const [lang, setLang] = useState<Language>('ja');
  const t = TRANSLATIONS[lang];

  const [device, setDevice] = useState<AIOCDevice | null>(null);
  const [values, setValues] = useState<RegisterValues>({});
  const [lastStoredValues, setLastStoredValues] = useState<RegisterValues>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);

  const hasUnsavedChanges = useMemo(() => {
      if (Object.keys(values).length === 0) return false;
      return Object.entries(values).some(([reg, val]) => lastStoredValues[parseInt(reg) as Register] !== val);
  }, [values, lastStoredValues]);

  const connect = async () => {
    try {
      const dev = await requestAIOC();
      if (dev) {
        await dev.open();
        setDevice(dev);
        setError(null);
        // Initial read
        const newValues: RegisterValues = {};
        for (const reg of Object.values(Register) as Register[]) {
          if (typeof reg === 'number') {
            newValues[reg] = await dev.read(reg);
          }
        }
        setValues(newValues);
        setLastStoredValues(newValues);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    }
  };

  const readAll = async () => {
    if (!device) return;
    setLoading(true);
    setError(null);
    try {
      const newValues: RegisterValues = {};
      for (const reg of Object.values(Register) as Register[]) {
        if (typeof reg === 'number') {
          newValues[reg] = await device.read(reg);
        }
      }
      setValues(newValues);
      setLastStoredValues(newValues);
    } catch (err: any) {
      setError(err.message || 'Failed to read registers');
    } finally {
      setLoading(false);
    }
  };

  const writeRegister = async (reg: Register, value: number) => {
    if (!device) return;
    try {
      await device.write(reg, value);
      const newValue = await device.read(reg);
      setValues(prev => ({ ...prev, [reg]: newValue }));
    } catch (err: any) {
      setError(err.message || 'Failed to write register');
    }
  };

  const applyPreset = async (presetName: string) => {
      const preset = (PRESETS(t) as any)[presetName];
      if (!preset) return;
      setLoading(true);
      try {
          for (const [regStr, val] of Object.entries(preset)) {
              const reg = parseInt(regStr) as Register;
              if (values[reg] !== val) {
                  await writeRegister(reg, val as number);
              }
          }
      } catch (err: any) {
          setError(`Failed to apply preset: ${err.message}`);
      } finally {
          setLoading(false);
      }
  };

  const sendCmd = async (cmd: Command) => {
    if (!device) return;
    try {
      await device.sendCommand(cmd);
      if (cmd === Command.REBOOT) {
        setDevice(null);
        setValues({});
        setLastStoredValues({});
      } else if (cmd === Command.STORE) {
          setLastStoredValues({ ...values });
      } else {
        await readAll();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send command');
    }
  };

  const exportToINI = () => {
      let content = `; AIOC Configuration File\n[AIOC]\n`;
      Object.entries(Register)
        .filter(([_, v]) => typeof v === 'number')
        .forEach(([name, reg]) => {
            const val = values[reg as Register];
            if (val !== undefined) {
                content += `${name}=${formatHex(val)}\n`;
            }
        });
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aioc_config_export.ini`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const importFromINI = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
          const text = event.target?.result as string;
          const lines = text.split('\n');
          const newValues = { ...values };
          
          lines.forEach(line => {
              const [key, valStr] = line.split('=').map(s => s.trim());
              if (key && valStr && (Register as any)[key] !== undefined) {
                  const reg = (Register as any)[key] as Register;
                  const val = valStr.startsWith('0x') ? parseInt(valStr, 16) : parseInt(valStr, 10);
                  if (!isNaN(val)) {
                      newValues[reg] = val;
                  }
              }
          });
          setValues(newValues);
          setError(null);
      };
      reader.readAsText(file);
      e.target.value = '';
  };

  const formatHex = (val?: number) => val !== undefined ? `0x${val.toString(16).padStart(8, '0').toUpperCase()}` : '---';
  const formatTime = (val?: number) => val !== undefined ? (val / 16000).toFixed(3) : '---';

  const getFoxhuntMessage = () => {
    const msg0 = values[Register.FOXHUNT_MSG0] || 0;
    const msg1 = values[Register.FOXHUNT_MSG1] || 0;
    const msg2 = values[Register.FOXHUNT_MSG2] || 0;
    const msg3 = values[Register.FOXHUNT_MSG3] || 0;
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, msg0, true);
    view.setUint32(4, msg1, true);
    view.setUint32(8, msg2, true);
    view.setUint32(12, msg3, true);
    let str = '';
    for (let i = 0; i < 16; i++) {
        if (bytes[i] === 0) break;
        str += String.fromCharCode(bytes[i]);
    }
    return str;
  };

  const setFoxhuntMessage = async (msg: string) => {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16 && i < msg.length; i++) {
          bytes[i] = msg.charCodeAt(i);
      }
      const view = new DataView(bytes.buffer);
      await writeRegister(Register.FOXHUNT_MSG0, view.getUint32(0, true));
      await writeRegister(Register.FOXHUNT_MSG1, view.getUint32(4, true));
      await writeRegister(Register.FOXHUNT_MSG2, view.getUint32(8, true));
      await writeRegister(Register.FOXHUNT_MSG3, view.getUint32(12, true));
  };

  const setFoxhuntPart = async (part: 'vol' | 'wpm' | 'int', val: number) => {
      const current = values[Register.FOXHUNT_CTRL] || 0;
      let vol = (current >> 16) & 0xFFFF;
      let wpm = (current >> 8) & 0xFF;
      let interval = (current >> 0) & 0xFF;

      if (part === 'vol') vol = val;
      if (part === 'wpm') wpm = val;
      if (part === 'int') interval = val;

      const newValue = ((vol & 0xFFFF) << 16) | ((wpm & 0xFF) << 8) | (interval & 0xFF);
      await writeRegister(Register.FOXHUNT_CTRL, newValue >>> 0);
  };

  const PTTCheckBoxes = ({ reg }: { reg: Register }) => {
      const currentVal = values[reg] || 0;
      return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              {Object.entries(PTTSource)
                .filter(([_, val]) => typeof val === 'number' && val !== 0)
                .map(([name, val]) => (
                    <label key={name} style={{ fontSize: '0.8em' }}>
                        <input 
                            type="checkbox" 
                            checked={(currentVal & (val as number)) === (val as number)}
                            onChange={(e) => {
                                const newVal = e.target.checked 
                                    ? currentVal | (val as number)
                                    : currentVal & ~(val as number);
                                writeRegister(reg, newVal);
                            }}
                        /> {name}
                    </label>
                ))}
          </div>
      );
  };

  const SelectInput = ({ reg, options }: { reg: Register, options: any }) => {
      const currentVal = values[reg] || 0;
      return (
          <select 
            value={currentVal} 
            onChange={(e) => writeRegister(reg, parseInt(e.target.value))}
          >
              {Object.entries(options)
                .filter(([_, v]) => typeof v === 'number')
                .map(([name, val]) => (
                  <option key={name} value={val as any}>{name}</option>
              ))}
          </select>
      );
  };

  const RestoreButton = ({ reg }: { reg: Register }) => (
      <button 
        onClick={() => writeRegister(reg, REGISTER_DEFAULTS[reg])}
        style={{ fontSize: '0.7em', padding: '2px 5px', marginLeft: '5px' }}
      >
          {t.reset}
      </button>
  );

  const HelpIcon = ({ reg, helpKey }: { reg?: number, helpKey?: keyof typeof t.help }) => {
      const helpText = helpKey ? t.help[helpKey] : (reg ? (t.help as any)[Register[reg]] : "");
      return (
          <span title={helpText || "No help available"} style={{ 
              cursor: 'help', 
              marginLeft: '5px', 
              color: '#0078d4',
              fontSize: '0.9em',
              fontWeight: 'bold',
              opacity: 0.7
          }}>(?)</span>
      );
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px', fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif', color: '#333' }}>
      <header style={{ borderBottom: '2px solid #0078d4', marginBottom: '20px', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, color: '#0078d4' }}>{t.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <p>{t.versionText}</p>
            <p>by {t.authorCallSign}</p>
            <p>based on <a href="https://github.com/hrafnkelle/aioc-util" >aioc-util</a></p>
            <select value={lang} onChange={(e) => setLang(e.target.value as Language)} style={{ padding: '5px' }}>
                <option value="ja">日本語</option>
                <option value="en">English</option>
            </select>
            {!device ? (
                <button onClick={connect} style={{ padding: '10px 20px', backgroundColor: '#0078d4', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{t.connect}</button>
            ) : (
                <span style={{ color: '#28a745', fontWeight: 'bold' }}> {t.connected}: {device.productName}</span>
            )}
        </div>
      </header>

      {error && (
          <div style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '10px', borderRadius: '4px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
              <span>{t.error}: {error}</span>
              <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
          </div>
      )}

      {!device ? (
          <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
              <p>{t.disconnected}</p>
          </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
          <main>
            <section style={{ marginBottom: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h2 style={{ margin: 0 }}>{t.registers}</h2>
                </div>

                {!manualMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1em' }}>{t.audioSettings}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.rxGain} <HelpIcon reg={Register.AUDIO_RX} /><RestoreButton reg={Register.AUDIO_RX} /></label>
                                    <SelectInput reg={Register.AUDIO_RX} options={RXGain} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.txBoost} <HelpIcon reg={Register.AUDIO_TX} /><RestoreButton reg={Register.AUDIO_TX} /></label>
                                    <SelectInput reg={Register.AUDIO_TX} options={TXBoost} />
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1em' }}>{t.pttSettings}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.ptt1Source} <HelpIcon reg={Register.AIOC_IOMUX0} /><RestoreButton reg={Register.AIOC_IOMUX0} /></label>
                                    <PTTCheckBoxes reg={Register.AIOC_IOMUX0} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.ptt2Source} <HelpIcon reg={Register.AIOC_IOMUX1} /><RestoreButton reg={Register.AIOC_IOMUX1} /></label>
                                    <PTTCheckBoxes reg={Register.AIOC_IOMUX1} />
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1em' }}>{t.buttons}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                                {[
                                    { label: 'Vol UP(CM108_IOMUX0)', reg: Register.CM108_IOMUX0 },
                                    { label: 'Vol DN(CM108_IOMUX1)', reg: Register.CM108_IOMUX1 },
                                    { label: 'Plb Mute(CM108_IOMUX2)', reg: Register.CM108_IOMUX2 },
                                    { label: 'Rec Mute(CM108_IOMUX3)', reg: Register.CM108_IOMUX3 }
                                ].map(btn => (
                                    <div key={btn.reg}>
                                        <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{btn.label} <HelpIcon reg={btn.reg} /><RestoreButton reg={btn.reg} /></label>
                                        <SelectInput reg={btn.reg} options={ButtonSource} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1em' }}>{t.timers}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.vpttDelay} <HelpIcon reg={Register.VPTT_TIMCTRL} /><RestoreButton reg={Register.VPTT_TIMCTRL} /></label>
                                    <input type="number" step="0.01" style={{ width: '100%', boxSizing: 'border-box' }} value={formatTime(values[Register.VPTT_TIMCTRL])} onChange={e => writeRegister(Register.VPTT_TIMCTRL, Math.round(parseFloat(e.target.value) * 16000))} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.vpttLevel} <HelpIcon reg={Register.VPTT_LVLCTRL} /><RestoreButton reg={Register.VPTT_LVLCTRL} /></label>
                                    <input type="number" style={{ width: '100%', boxSizing: 'border-box' }} value={values[Register.VPTT_LVLCTRL] || 0} onChange={e => writeRegister(Register.VPTT_LVLCTRL, parseInt(e.target.value))} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.vcosDelay} <HelpIcon reg={Register.VCOS_TIMCTRL} /><RestoreButton reg={Register.VCOS_TIMCTRL} /></label>
                                    <input type="number" step="0.01" style={{ width: '100%', boxSizing: 'border-box' }} value={formatTime(values[Register.VCOS_TIMCTRL])} onChange={e => writeRegister(Register.VCOS_TIMCTRL, Math.round(parseFloat(e.target.value) * 16000))} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.vcosLevel} <HelpIcon reg={Register.VCOS_LVLCTRL} /><RestoreButton reg={Register.VCOS_LVLCTRL} /></label>
                                    <input type="number" style={{ width: '100%', boxSizing: 'border-box' }} value={values[Register.VCOS_LVLCTRL] || 0} onChange={e => writeRegister(Register.VCOS_LVLCTRL, parseInt(e.target.value))} />
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1em' }}>{t.foxhunt}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.foxhuntVolume} <HelpIcon reg={Register.FOXHUNT_CTRL} /><RestoreButton reg={Register.FOXHUNT_CTRL} /></label>
                                    <input type="number" min="0" max="65535" style={{ width: '100%', boxSizing: 'border-box' }} value={(values[Register.FOXHUNT_CTRL] || 0) >> 16 & 0xFFFF} onChange={e => setFoxhuntPart('vol', parseInt(e.target.value))} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.foxhuntWPM}</label>
                                    <input type="number" min="0" max="255" style={{ width: '100%', boxSizing: 'border-box' }} value={(values[Register.FOXHUNT_CTRL] || 0) >> 8 & 0xFF} onChange={e => setFoxhuntPart('wpm', parseInt(e.target.value))} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.foxhuntInterval}</label>
                                    <input type="number" min="0" max="255" style={{ width: '100%', boxSizing: 'border-box' }} value={(values[Register.FOXHUNT_CTRL] || 0) & 0xFF} onChange={e => setFoxhuntPart('int', parseInt(e.target.value))} />
                                </div>
                            </div>
                            <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '5px' }}>{t.message} <HelpIcon helpKey="FOXHUNT_MSG" /></label>
                            <input 
                                type="text" 
                                maxLength={16} 
                                style={{ width: '100%', boxSizing: 'border-box', marginBottom: '10px' }} 
                                defaultValue={getFoxhuntMessage()}
                                onBlur={(e) => setFoxhuntMessage(e.target.value)}
                            />
                        </div>
                        <label><input type="checkbox" disabled checked={manualMode} onChange={e => setManualMode(e.target.checked)} /> {t.manualMode}</label>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                                <th style={{ padding: '8px' }}>{t.registers}</th>
                                <th style={{ padding: '8px' }}>Value (Hex)</th>
                                <th style={{ padding: '8px' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(Register).filter(([_, v]) => typeof v === 'number').map(([name, reg]) => (
                                <tr key={reg} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '8px' }}>{name} <HelpIcon reg={reg as Register} /></td>
                                    <td style={{ padding: '8px' }}>
                                        <input 
                                            type="text" 
                                            defaultValue={formatHex(values[reg as Register])} 
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value, 16);
                                                if (!isNaN(val)) writeRegister(reg as Register, val);
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: '8px' }}><RestoreButton reg={reg as Register} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
          </main>

          <aside>
            <div style={{ padding: '15px', backgroundColor: '#f0f4f8', borderRadius: '8px', position: 'sticky', top: '20px' }}>
                <h3 style={{ margin: '0 0 15px 0' }}>{t.presets}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {Object.keys(PRESETS(t)).map(name => (
                        <button key={name} onClick={() => applyPreset(name)} style={{ padding: '8px', cursor: 'pointer' }}>{name}</button>
                    ))}
                </div>

                <hr style={{ margin: '20px 0' }} />

                <h3 style={{ margin: '0 0 15px 0' }}>{t.exportConfig} / {t.importConfig}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button onClick={exportToINI} style={{ padding: '8px' }}>{t.exportConfig}</button>
                    <label style={{ 
                        padding: '8px', 
                        backgroundColor: '#eee', 
                        border: '1px solid #ccc', 
                        borderRadius: '4px', 
                        textAlign: 'center', 
                        cursor: 'pointer' 
                    }}>
                        {t.importConfig}
                        <input type="file" accept=".ini" onChange={importFromINI} style={{ display: 'none' }} />
                    </label>
                </div>

                <hr style={{ margin: '20px 0' }} />

                <h3 style={{ margin: '0 0 15px 0' }}>{t.deviceControl}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button onClick={readAll} disabled={loading} style={{ padding: '8px' }}>{loading ? t.reading : t.refreshAll}</button>
                    
                    <button 
                        onClick={() => sendCmd(Command.STORE)} 
                        style={{ 
                            padding: '12px', 
                            backgroundColor: hasUnsavedChanges ? '#ffc107' : '#28a745', 
                            color: hasUnsavedChanges ? '#000' : 'white', 
                            border: hasUnsavedChanges ? '2px solid #e0a800' : 'none', 
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            boxShadow: hasUnsavedChanges ? '0 0 10px rgba(255, 193, 7, 0.5)' : 'none',
                            cursor: 'pointer'
                        }}
                    >
                        {hasUnsavedChanges ? t.storeToFlashRequired : t.storeToFlash}
                    </button>

                    {hasUnsavedChanges && (
                        <p style={{ color: '#856404', backgroundColor: '#fff3cd', padding: '10px', borderRadius: '4px', fontSize: '0.85em', margin: '0', border: '1px solid #ffeeba' }}>
                            {t.unsavedChanges}
                        </p>
                    )}

                    <button onClick={() => sendCmd(Command.DEFAULTS)} style={{ padding: '8px' }}>{t.factoryReset}</button>
                    <button onClick={() => sendCmd(Command.REBOOT)} style={{ padding: '8px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px' }}>{t.reboot}</button>
                </div>

                <hr style={{ margin: '20px 0' }} />
                <h3 style={{ margin: '0 0 15px 0' }}>{t.infoHeader}</h3>
                <p>{t.versionText}</p>
                <p> by {t.authorCallSign} / {t.authorContact}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default App;
