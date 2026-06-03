// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO

const CONTRACT_REQUEST_TYPES = new Set(['Request', 'EPR_Request']);
const CONTRACT_RESPONSE_TYPES = new Set(['GoodCRC', 'Accept', 'Reject', 'Wait', 'PS_RDY', 'Not_Supported']);
const OPPOSITE_DIR = { 'SRC→SNK': 'SNK→SRC', 'SNK→SRC': 'SRC→SNK' };
const QUERY_RESPONSE_MAP = {
  Get_Source_Cap: 'Source_Capabilities',
  Get_Sink_Cap: 'Sink_Capabilities',
  Get_Source_Cap_Extended: 'Source_Capabilities_Extended',
  Get_Status: 'Status',
  Get_PPS_Status: 'PPS_Status',
  Get_Country_Codes: 'Country_Codes',
  Get_Sink_Cap_Extended: 'Sink_Capabilities_Extended',
  Get_Source_Info: 'Source_Info',
  Get_Revision: 'Revision',
  Get_Country_Info: 'Country_Info',
};
const QUERY_ALT_RESPONSES = new Set(['Not_Supported', 'Reject', 'Wait']);

function removePendingById(list, id) {
  const idx = list.findIndex((item) => item.id === id);
  if (idx !== -1) list.splice(idx, 1);
}

export function buildContractLinks(messages) {
  const links = new Map();
  let pendingRequest = null;
  let awaitingPsRdy = null;
  const pendingQueriesByResponse = new Map();
  const pendingAnyQuery = [];

  for (const msg of messages ?? []) {
    const typeName = msg?.header?.typeName;
    const msgId = msg?.id;
    if (msgId == null || !typeName) continue;

    const expectedQueryResponse = QUERY_RESPONSE_MAP[typeName];
    if (expectedQueryResponse) {
      const req = { id: msgId, typeName, responseType: expectedQueryResponse };
      const queue = pendingQueriesByResponse.get(expectedQueryResponse) ?? [];
      queue.push(req);
      pendingQueriesByResponse.set(expectedQueryResponse, queue);
      pendingAnyQuery.push(req);
      links.set(msgId, {
        role: 'query-request',
        requestId: msgId,
        requestType: typeName,
        responseType: expectedQueryResponse,
        responseId: null,
      });
      continue;
    }

    const expectedQueue = pendingQueriesByResponse.get(typeName);
    if (expectedQueue?.length) {
      const req = expectedQueue.shift();
      if (expectedQueue.length === 0) pendingQueriesByResponse.delete(typeName);
      removePendingById(pendingAnyQuery, req.id);
      const reqLink = links.get(req.id);
      if (reqLink) {
        reqLink.responseType = typeName;
        reqLink.responseId = msgId;
      }
      links.set(msgId, {
        role: 'query-response',
        requestId: req.id,
        requestType: req.typeName,
        responseType: typeName,
      });
      continue;
    }

    if (!pendingRequest && QUERY_ALT_RESPONSES.has(typeName) && pendingAnyQuery.length) {
      const req = pendingAnyQuery.shift();
      const specificQueue = pendingQueriesByResponse.get(req.responseType);
      if (specificQueue) {
        removePendingById(specificQueue, req.id);
        if (specificQueue.length === 0) pendingQueriesByResponse.delete(req.responseType);
      }
      const reqLink = links.get(req.id);
      if (reqLink) {
        reqLink.responseType = typeName;
        reqLink.responseId = msgId;
      }
      links.set(msgId, {
        role: 'query-response',
        requestId: req.id,
        requestType: req.typeName,
        responseType: typeName,
      });
      continue;
    }

    if (CONTRACT_REQUEST_TYPES.has(typeName)) {
      pendingRequest = { id: msgId, typeName };
      awaitingPsRdy = null;
      links.set(msgId, {
        role: 'request',
        requestId: msgId,
        requestType: typeName,
        responses: [],
        responseId: null,
        responseType: null,
        psRdyId: null,
      });
      continue;
    }

    if (!pendingRequest || !CONTRACT_RESPONSE_TYPES.has(typeName)) continue;

    const requestLink = links.get(pendingRequest.id);
    if (requestLink) {
      requestLink.responses.push({ id: msgId, typeName });
      if (requestLink.responseId == null) {
        requestLink.responseId = msgId;
        requestLink.responseType = typeName;
      }
      if (typeName === 'PS_RDY') {
        requestLink.psRdyId = msgId;
      }
    }

    links.set(msgId, {
      role: 'response',
      requestId: pendingRequest.id,
      requestType: pendingRequest.typeName,
      stage: typeName,
    });

    if (typeName === 'Accept') {
      awaitingPsRdy = pendingRequest;
    } else if (typeName === 'PS_RDY' && awaitingPsRdy) {
      pendingRequest = null;
      awaitingPsRdy = null;
    } else if (typeName === 'Reject' || typeName === 'Wait' || typeName === 'Not_Supported') {
      pendingRequest = null;
      awaitingPsRdy = null;
    }
  }

  return links;
}

export function buildGoodCrcChecks(messages) {
  const checks = new Map();
  const lastBySopAndDir = new Map();

  for (const msg of messages ?? []) {
    const typeName = msg?.header?.typeName;
    const msgId = msg?.header?.msgId;
    const dirName = msg?.cpd?.dirName;
    const sopName = msg?.cpd?.sopQualName ?? 'SOP';

    if (!typeName || !dirName) continue;

    if (typeName === 'GoodCRC') {
      const oppositeDir = OPPOSITE_DIR[dirName];
      if (!oppositeDir) continue;

      const peer = lastBySopAndDir.get(`${sopName}|${oppositeDir}`);
      if (peer && Number.isInteger(msgId) && Number.isInteger(peer.msgId)) {
        checks.set(msg.id, {
          ok: msgId === peer.msgId,
          expectedMsgId: peer.msgId,
          observedMsgId: msgId,
          pairId: peer.id,
          pairType: peer.typeName,
        });
      }
      continue;
    }

    if (Number.isInteger(msgId)) {
      lastBySopAndDir.set(`${sopName}|${dirName}`, { id: msg.id, msgId, typeName });
    }
  }

  return checks;
}

export function describeTypeName(typeName) {
  if (!typeName) {
    return { label: '—', shifted: false };
  }

  if (typeName === 'GoodCRC') {
    return { label: typeName, shifted: true };
  }

  if (typeName === 'Accept' || typeName === 'Reject' || typeName === 'Wait' || typeName === 'PS_RDY' || typeName === 'Not_Supported') {
    return { label: typeName, shifted: false };
  }

  if (/(^|_)NAK(_|$)/.test(typeName) || /(^|_)NG(_|$)/.test(typeName)) {
    return { label: `🚫 ${typeName}`, shifted: false };
  }

  if (typeName === 'BUSY') {
    return { label: `⏳ ${typeName}`, shifted: false };
  }

  return { label: typeName, shifted: false };
}

export function formatLinkSummary(link) {
  if (!link) return null;

  if (link.role === 'request') {
    const parts = (link.responses ?? []).map((response) => response.typeName);
    if (link.psRdyId != null && !parts.includes('PS_RDY')) parts.push('PS_RDY');
    if (parts.length === 0) return null;
    return `↔ ${parts.join(' → ')}`;
  }

  if (link.role === 'query-request') {
    if (link.responseId == null) return null;
    return `↔ ${link.responseType}`;
  }

  if (link.role === 'query-response') {
    return `↩ ${link.requestType}#${link.requestId}`;
  }

  return `↩ ${link.requestType}#${link.requestId}`;
}
