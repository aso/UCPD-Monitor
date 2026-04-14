import re

JSX = r'd:\My\source\STMicro\STM32CubeMonitor-UCPD-Web\client\src\components\TopologyView.jsx'

with open(JSX, 'r', encoding='utf-8') as f:
    content = f.read()

start = content.find('// \u2500\u2500 Contract banner \u2014 confirmed values on the cable')
end_marker = '\nfunction NodeBox('
end = content.find(end_marker, start)

if start < 0 or end < 0:
    print(f'NOT FOUND: start={start} end={end}')
    exit(1)

new_block = (
    '// \u2500\u2500 Contract values inside eMarker \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n'
    '\n'
    'function ContractInRow({ label, value, unit, color }) {\n'
    '  return (\n'
    '    <div className={styles.contractInRow}>\n'
    '      <span className={styles.contractInLabel}>{label}</span>\n'
    '      <span className={styles.contractInValue} style={{ color }}>{value}</span>\n'
    '      <span className={styles.contractInUnit}>{unit}</span>\n'
    '    </div>\n'
    '  );\n'
    '}\n'
    '\n'
    'function ContractInMarker({ contract }) {\n'
    "  const DIM = '#0e2a0e';\n"
    '  if (!contract) {\n'
    '    return (\n'
    '      <div className={styles.contractIn}>\n'
    '        <ContractInRow label="Contract.V" value="---.---" unit="V" color={DIM} />\n'
    '        <ContractInRow label="Contract.I" value="---.--"  unit="A" color={DIM} />\n'
    '      </div>\n'
    '    );\n'
    '  }\n'
    "  const { pdo, objPos, opVoltage_mV, opCurrent_mA, opPower_mW, rdoType } = contract;\n"
    "  const isAdj     = rdoType === 'PPS' || rdoType === 'AVS';\n"
    "  const isBattery = rdoType === 'Battery';\n"
    '  const vMv = isAdj ? opVoltage_mV\n'
    "    : pdo?.pdoType === 'Fixed' ? pdo.vMv\n"
    '    : null;\n'
    '  return (\n'
    '    <div className={styles.contractIn}>\n'
    '      <span className={styles.contractInPdo}>PDO\u00a0#{objPos}</span>\n'
    '      <ContractInRow\n'
    '        label="Contract.V"\n'
    "        value={vMv != null ? (vMv / 1000).toFixed(3) : '---.---'}\n"
    '        unit="V"\n'
    '        color="#80deea"\n'
    '      />\n'
    '      {isBattery\n'
    '        ? <ContractInRow\n'
    '            label="Contract.P"\n'
    "            value={opPower_mW != null ? (opPower_mW / 1000).toFixed(2) : '---.--'}\n"
    '            unit="W"\n'
    '            color="#ffcc80"\n'
    '          />\n'
    '        : <ContractInRow\n'
    '            label="Contract.I"\n'
    "            value={opCurrent_mA != null ? (opCurrent_mA / 1000).toFixed(2) : '---.--'}\n"
    '            unit="A"\n'
    '            color="#a5d6a7"\n'
    '          />\n'
    '      }\n'
    '    </div>\n'
    '  );\n'
    '}\n'
)

new_content = content[:start] + new_block + content[end:]
with open(JSX, 'w', encoding='utf-8') as f:
    f.write(new_content)
print('done')
