import { describe, it, expect } from 'vitest';
import { buildContractLinks, buildGoodCrcChecks, describeTypeName, formatLinkSummary } from './messageLogLinking';

describe('messageLogLinking', () => {
  it('links Request to GoodCRC, Accept, and PS_RDY', () => {
    const messages = [
      { id: 1, header: { typeName: 'Source_Capabilities' } },
      { id: 2, header: { typeName: 'Request' } },
      { id: 3, header: { typeName: 'GoodCRC' } },
      { id: 4, header: { typeName: 'Accept' } },
      { id: 5, header: { typeName: 'PS_RDY' } },
    ];

    const links = buildContractLinks(messages);
    const request = links.get(2) as any;
    expect(request.role).toBe('request');
    expect(request.responses.map((r: { typeName: string }) => r.typeName)).toEqual(['GoodCRC', 'Accept', 'PS_RDY']);
    expect(request.psRdyId).toBe(5);
    expect(formatLinkSummary(request)).toBe('↔ GoodCRC → Accept → PS_RDY');

    const accept = links.get(4) as any;
    expect(accept.role).toBe('response');
    expect(accept.requestId).toBe(2);
    expect(formatLinkSummary(accept)).toBe('↩ Request#2');
  });

  it('flags NAK-style labels and response-like types', () => {
    expect(describeTypeName('GoodCRC')).toMatchObject({ shifted: true, label: 'GoodCRC' });
    expect(describeTypeName('Discover_Identity_NAK')).toMatchObject({ label: '🚫 Discover_Identity_NAK' });
    expect(describeTypeName('BUSY')).toMatchObject({ label: '⏳ BUSY' });
  });

  it('links Get_* request to its response', () => {
    const messages = [
      { id: 10, header: { typeName: 'Get_Status' } },
      { id: 11, header: { typeName: 'Status' } },
      { id: 12, header: { typeName: 'Get_Source_Info' } },
      { id: 13, header: { typeName: 'Not_Supported' } },
    ];

    const links = buildContractLinks(messages);
    const getStatus = links.get(10) as any;
    expect(getStatus.role).toBe('query-request');
    expect(getStatus.responseId).toBe(11);
    expect(formatLinkSummary(getStatus)).toBe('↔ Status');

    const status = links.get(11) as any;
    expect(status.role).toBe('query-response');
    expect(formatLinkSummary(status)).toBe('↩ Get_Status#10');

    const getSourceInfo = links.get(12) as any;
    expect(getSourceInfo.responseType).toBe('Not_Supported');
    expect(formatLinkSummary(getSourceInfo)).toBe('↔ Not_Supported');
  });

  it('validates GoodCRC MsgID handshake pair', () => {
    const messages = [
      { id: 20, cpd: { dirName: 'SRC→SNK', sopQualName: 'SOP' }, header: { typeName: 'Accept', msgId: 3 } },
      { id: 21, cpd: { dirName: 'SNK→SRC', sopQualName: 'SOP' }, header: { typeName: 'GoodCRC', msgId: 3 } },
      { id: 22, cpd: { dirName: 'SRC→SNK', sopQualName: 'SOP' }, header: { typeName: 'Get_Status', msgId: 4 } },
      { id: 23, cpd: { dirName: 'SNK→SRC', sopQualName: 'SOP' }, header: { typeName: 'GoodCRC', msgId: 6 } },
    ];

    const checks = buildGoodCrcChecks(messages);
    expect((checks.get(21) as any).ok).toBe(true);
    const bad = checks.get(23) as any;
    expect(bad.ok).toBe(false);
    expect(bad.expectedMsgId).toBe(4);
    expect(bad.observedMsgId).toBe(6);
  });
});