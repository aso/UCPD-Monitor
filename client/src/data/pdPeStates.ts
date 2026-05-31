/**
 * USB PD Policy Engine State Dictionary
 *
 * Source: USB Power Delivery Specification Revision 3.2, Version 1.0, 2023-10
 *         Table 8.157 "Policy Engine States" — §8.3.3.30 (pp. 703 ff.)
 *
 * Usage:
 *   import { PE_STATES, lookupPeState, PE_GROUPS } from '../data/pdPeStates';
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Primary port role associated with a Policy Engine state. */
export type PeRole =
  | 'SRC'   // Source port
  | 'SNK'   // Sink port
  | 'DFP'   // Downstream-facing port (data)
  | 'UFP'   // Upstream-facing port (data)
  | 'CBL'   // Cable plug
  | 'ANY';  // Role-independent or shared

export interface PeState {
  readonly name: string;
  readonly group: string;
  readonly role: PeRole;
  readonly section: string;
}

// ---------------------------------------------------------------------------
// Full state table — Table 8.157
// ---------------------------------------------------------------------------

export const PE_STATES: readonly PeState[] = [

  // ── SenderResponseTimer ─────────────────────────────────────────────────
  { name: 'SRT_Stopped',                         group: 'Timer',              role: 'ANY', section: '8.3.3.1.1' },
  { name: 'SRT_Running',                         group: 'Timer',              role: 'ANY', section: '8.3.3.1.1' },
  { name: 'SRT_Expired',                         group: 'Timer',              role: 'ANY', section: '8.3.3.1.1' },

  // ── Source Port ─────────────────────────────────────────────────────────
  { name: 'PE_SRC_Startup',                      group: 'Source',             role: 'SRC', section: '8.3.3.2.1'  },
  { name: 'PE_SRC_Discovery',                    group: 'Source',             role: 'SRC', section: '8.3.3.2.2'  },
  { name: 'PE_SRC_Send_Capabilities',            group: 'Source',             role: 'SRC', section: '8.3.3.2.3'  },
  { name: 'PE_SRC_Negotiate_Capability',         group: 'Source',             role: 'SRC', section: '8.3.3.2.4'  },
  { name: 'PE_SRC_Transition_Supply',            group: 'Source',             role: 'SRC', section: '8.3.3.2.5'  },
  { name: 'PE_SRC_Ready',                        group: 'Source',             role: 'SRC', section: '8.3.3.2.6'  },
  { name: 'PE_SRC_Disabled',                     group: 'Source',             role: 'SRC', section: '8.3.3.2.7'  },
  { name: 'PE_SRC_Capability_Response',          group: 'Source',             role: 'SRC', section: '8.3.3.2.8'  },
  { name: 'PE_SRC_Hard_Reset',                   group: 'Source',             role: 'SRC', section: '8.3.3.2.9'  },
  { name: 'PE_SRC_Hard_Reset_Received',          group: 'Source',             role: 'SRC', section: '8.3.3.2.10' },
  { name: 'PE_SRC_Transition_to_default',        group: 'Source',             role: 'SRC', section: '8.3.3.2.11' },
  { name: 'PE_SRC_Get_Sink_Cap',                 group: 'Source',             role: 'SRC', section: '8.3.3.2.12' },
  { name: 'PE_SRC_Wait_New_Capabilities',        group: 'Source',             role: 'SRC', section: '8.3.3.2.13' },
  { name: 'PE_SRC_EPR_Keep_Alive',               group: 'Source',             role: 'SRC', section: '8.3.3.2.14' },
  { name: 'PE_SRC_Give_Source_Cap',              group: 'Source',             role: 'SRC', section: '8.3.3.2.15' },

  // ── Sink Port ────────────────────────────────────────────────────────────
  { name: 'PE_SNK_Startup',                      group: 'Sink',               role: 'SNK', section: '8.3.3.3.1'  },
  { name: 'PE_SNK_Discovery',                    group: 'Sink',               role: 'SNK', section: '8.3.3.3.2'  },
  { name: 'PE_SNK_Wait_for_Capabilities',        group: 'Sink',               role: 'SNK', section: '8.3.3.3.3'  },
  { name: 'PE_SNK_Evaluate_Capability',          group: 'Sink',               role: 'SNK', section: '8.3.3.3.4'  },
  { name: 'PE_SNK_Select_Capability',            group: 'Sink',               role: 'SNK', section: '8.3.3.3.5'  },
  { name: 'PE_SNK_Transition_Sink',              group: 'Sink',               role: 'SNK', section: '8.3.3.3.6'  },
  { name: 'PE_SNK_Ready',                        group: 'Sink',               role: 'SNK', section: '8.3.3.3.7'  },
  { name: 'PE_SNK_Hard_Reset',                   group: 'Sink',               role: 'SNK', section: '8.3.3.3.8'  },
  { name: 'PE_SNK_Transition_to_default',        group: 'Sink',               role: 'SNK', section: '8.3.3.3.9'  },
  { name: 'PE_SNK_Give_Sink_Cap',                group: 'Sink',               role: 'SNK', section: '8.3.3.3.10' },
  { name: 'PE_SNK_EPR_Keep_Alive',               group: 'Sink',               role: 'SNK', section: '8.3.3.3.11' },
  { name: 'PE_SNK_Get_Source_Cap',               group: 'Sink',               role: 'SNK', section: '8.3.3.3.12' },

  // ── Soft Reset — Source ──────────────────────────────────────────────────
  { name: 'PE_SRC_Send_Soft_Reset',              group: 'Soft Reset',         role: 'SRC', section: '8.3.3.4.1.1' },
  { name: 'PE_SRC_Soft_Reset',                   group: 'Soft Reset',         role: 'SRC', section: '8.3.3.4.1.2' },

  // ── Soft Reset — Sink ────────────────────────────────────────────────────
  { name: 'PE_SNK_Send_Soft_Reset',              group: 'Soft Reset',         role: 'SNK', section: '8.3.3.4.2.1' },
  { name: 'PE_SNK_Soft_Reset',                   group: 'Soft Reset',         role: 'SNK', section: '8.3.3.4.2.2' },

  // ── Data Reset — DFP ─────────────────────────────────────────────────────
  { name: 'PE_DDR_Send_Data_Reset',              group: 'Data Reset',         role: 'DFP', section: '8.3.3.5.1.1' },
  { name: 'PE_DDR_Data_Reset_Received',          group: 'Data Reset',         role: 'DFP', section: '8.3.3.5.1.2' },
  { name: 'PE_DDR_Wait_For_VCONN_Off',           group: 'Data Reset',         role: 'DFP', section: '8.3.3.5.1.3' },
  { name: 'PE_DDR_Perform_Data_Reset',           group: 'Data Reset',         role: 'DFP', section: '8.3.3.5.1.4' },

  // ── Data Reset — UFP ─────────────────────────────────────────────────────
  { name: 'PE_UDR_Send_Data_Reset',              group: 'Data Reset',         role: 'UFP', section: '8.3.3.5.2.1' },
  { name: 'PE_UDR_Data_Reset_Received',          group: 'Data Reset',         role: 'UFP', section: '8.3.3.5.2.2' },
  { name: 'PE_UDR_Turn_Off_VCONN',               group: 'Data Reset',         role: 'UFP', section: '8.3.3.5.2.3' },
  { name: 'PE_UDR_Send_Ps_Rdy',                  group: 'Data Reset',         role: 'UFP', section: '8.3.3.5.2.4' },
  { name: 'PE_UDR_Wait_For_Data_Reset_Complete', group: 'Data Reset',         role: 'UFP', section: '8.3.3.5.2.5' },

  // ── Not Supported — Source ───────────────────────────────────────────────
  { name: 'PE_SRC_Send_Not_Supported',           group: 'Not Supported',      role: 'SRC', section: '8.3.3.6.1.1' },
  { name: 'PE_SRC_Not_Supported_Received',       group: 'Not Supported',      role: 'SRC', section: '8.3.3.6.1.2' },
  { name: 'PE_SRC_Chunk_Received',               group: 'Not Supported',      role: 'SRC', section: '8.3.3.6.1.3' },

  // ── Not Supported — Sink ─────────────────────────────────────────────────
  { name: 'PE_SNK_Send_Not_Supported',           group: 'Not Supported',      role: 'SNK', section: '8.3.3.6.2.1' },
  { name: 'PE_SNK_Not_Supported_Received',       group: 'Not Supported',      role: 'SNK', section: '8.3.3.6.2.2' },
  { name: 'PE_SNK_Chunk_Received',               group: 'Not Supported',      role: 'SNK', section: '8.3.3.6.2.3' },

  // ── Ping ─────────────────────────────────────────────────────────────────
  { name: 'PE_SRC_Ping',                         group: 'Ping',               role: 'SRC', section: '8.3.3.7.1' },

  // ── Alert — Source Port Source Alert ─────────────────────────────────────
  { name: 'PE_SRC_Send_Source_Alert',            group: 'Alert',              role: 'SRC', section: '8.3.3.8.1.1' },
  { name: 'PE_SRC_Wait_for_Get_Status',          group: 'Alert',              role: 'SRC', section: '8.3.3.8.1.2' },

  // ── Alert — Sink Port Source Alert ───────────────────────────────────────
  { name: 'PE_SNK_Source_Alert_Received',        group: 'Alert',              role: 'SNK', section: '8.3.3.8.2.1' },

  // ── Alert — Sink Port Sink Alert ─────────────────────────────────────────
  { name: 'PE_SNK_Send_Sink_Alert',              group: 'Alert',              role: 'SNK', section: '8.3.3.8.3.1' },
  { name: 'PE_SNK_Wait_for_Get_Status',          group: 'Alert',              role: 'SNK', section: '8.3.3.8.3.2' },

  // ── Alert — Source Port Sink Alert ───────────────────────────────────────
  { name: 'PE_SRC_Sink_Alert_Received',          group: 'Alert',              role: 'SRC', section: '8.3.3.8.4.1' },

  // ── Extended Capabilities ────────────────────────────────────────────────
  { name: 'PE_SNK_Get_Source_Cap_Ext',           group: 'Ext Capabilities',   role: 'SNK', section: '8.3.3.9.1.1' },
  { name: 'PE_SRC_Give_Source_Cap_Ext',          group: 'Ext Capabilities',   role: 'SRC', section: '8.3.3.9.2.1' },
  { name: 'PE_SRC_Get_Sink_Cap_Ext',             group: 'Ext Capabilities',   role: 'SRC', section: '8.3.3.9.3.1' },
  { name: 'PE_SNK_Give_Sink_Cap_Ext',            group: 'Ext Capabilities',   role: 'SNK', section: '8.3.3.9.4.1' },

  // ── Source Information ───────────────────────────────────────────────────
  { name: 'PE_SNK_Get_Source_Info',              group: 'Source Info',        role: 'SNK', section: '8.3.3.10.1.1' },
  { name: 'PE_SRC_Give_Source_Info',             group: 'Source Info',        role: 'SRC', section: '8.3.3.10.2.1' },

  // ── Status ───────────────────────────────────────────────────────────────
  { name: 'PE_Get_Status',                       group: 'Status',             role: 'ANY', section: '8.3.3.10.1.1' },
  { name: 'PE_Give_Status',                      group: 'Status',             role: 'ANY', section: '8.3.3.10.2.1' },
  { name: 'PE_SNK_Get_PPS_Status',               group: 'Status',             role: 'SNK', section: '8.3.3.10.5.1' },
  { name: 'PE_SRC_Give_PPS_Status',              group: 'Status',             role: 'SRC', section: '8.3.3.10.6.1' },

  // ── Battery Capabilities ─────────────────────────────────────────────────
  { name: 'PE_Get_Battery_Cap',                  group: 'Battery',            role: 'ANY', section: '8.3.3.11.1.1' },
  { name: 'PE_Give_Battery_Cap',                 group: 'Battery',            role: 'ANY', section: '8.3.3.11.2.1' },

  // ── Battery Status ───────────────────────────────────────────────────────
  { name: 'PE_Get_Battery_Status',               group: 'Battery',            role: 'ANY', section: '8.3.3.12.1.1' },
  { name: 'PE_Give_Battery_Status',              group: 'Battery',            role: 'ANY', section: '8.3.3.12.2.1' },

  // ── Manufacturer Information ─────────────────────────────────────────────
  { name: 'PE_Get_Manufacturer_Info',            group: 'Manufacturer Info',  role: 'ANY', section: '8.3.3.13.1' },
  { name: 'PE_Give_Manufacturer_Info',           group: 'Manufacturer Info',  role: 'ANY', section: '8.3.3.13.2' },

  // ── Country Codes and Information ────────────────────────────────────────
  { name: 'PE_Get_Country_Codes',                group: 'Country',            role: 'ANY', section: '8.3.3.14.1.1' },
  { name: 'PE_Give_Country_Codes',               group: 'Country',            role: 'ANY', section: '8.3.3.14.2.1' },
  { name: 'PE_Get_Country_Info',                 group: 'Country',            role: 'ANY', section: '8.3.3.14.3.1' },
  { name: 'PE_Give_Country_Info',                group: 'Country',            role: 'ANY', section: '8.3.3.14.4.1' },

  // ── Revision ─────────────────────────────────────────────────────────────
  { name: 'PE_Get_Revision',                     group: 'Revision',           role: 'ANY', section: '8.3.3.15.1.1' },
  { name: 'PE_Give_Revision',                    group: 'Revision',           role: 'ANY', section: '8.3.3.15.2.1' },

  // ── Enter USB ────────────────────────────────────────────────────────────
  { name: 'PE_DEU_Send_Enter_USB',               group: 'Enter USB',          role: 'DFP', section: '8.3.3.15.1.1' },
  { name: 'PE_UEU_Enter_USB_Received',           group: 'Enter USB',          role: 'UFP', section: '8.3.3.15.2.1' },

  // ── Security ─────────────────────────────────────────────────────────────
  { name: 'PE_Send_Security_Request',            group: 'Security',           role: 'ANY', section: '8.3.3.16.1' },
  { name: 'PE_Send_Security_Response',           group: 'Security',           role: 'ANY', section: '8.3.3.16.2' },
  { name: 'PE_Security_Response_Received',       group: 'Security',           role: 'ANY', section: '8.3.3.16.3' },

  // ── Firmware Update ──────────────────────────────────────────────────────
  { name: 'PE_Send_Firmware_Update_Request',            group: 'Firmware Update', role: 'ANY', section: '8.3.3.17.1.1' },
  { name: 'PE_Send_Firmware_Update_Response',           group: 'Firmware Update', role: 'ANY', section: '8.3.3.17.2.1' },
  { name: 'PE_Firmware_Update_Response_Received',       group: 'Firmware Update', role: 'ANY', section: '8.3.3.17.3.1' },

  // ── Data Role Swap — DFP→UFP ─────────────────────────────────────────────
  { name: 'PE_DRS_DFP_UFP_Evaluate_Swap',        group: 'Data Role Swap',     role: 'DFP', section: '8.3.3.18.1.2' },
  { name: 'PE_DRS_DFP_UFP_Accept_Swap',          group: 'Data Role Swap',     role: 'DFP', section: '8.3.3.18.1.3' },
  { name: 'PE_DRS_DFP_UFP_Change_to_UFP',        group: 'Data Role Swap',     role: 'DFP', section: '8.3.3.18.1.4' },
  { name: 'PE_DRS_DFP_UFP_Send_Swap',            group: 'Data Role Swap',     role: 'DFP', section: '8.3.3.18.1.5' },
  { name: 'PE_DRS_DFP_UFP_Reject_Swap',          group: 'Data Role Swap',     role: 'DFP', section: '8.3.3.18.1.6' },

  // ── Data Role Swap — UFP→DFP ─────────────────────────────────────────────
  { name: 'PE_DRS_UFP_DFP_Evaluate_Swap',        group: 'Data Role Swap',     role: 'UFP', section: '8.3.3.18.2.2' },
  { name: 'PE_DRS_UFP_DFP_Accept_Swap',          group: 'Data Role Swap',     role: 'UFP', section: '8.3.3.18.2.3' },
  { name: 'PE_DRS_UFP_DFP_Change_to_DFP',        group: 'Data Role Swap',     role: 'UFP', section: '8.3.3.18.2.4' },
  { name: 'PE_DRS_UFP_DFP_Send_Swap',            group: 'Data Role Swap',     role: 'UFP', section: '8.3.3.18.2.5' },
  { name: 'PE_DRS_UFP_DFP_Reject_Swap',          group: 'Data Role Swap',     role: 'UFP', section: '8.3.3.18.2.6' },

  // ── Power Role Swap — SRC→SNK ────────────────────────────────────────────
  { name: 'PE_PRS_SRC_SNK_Evaluate_Swap',        group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.2' },
  { name: 'PE_PRS_SRC_SNK_Accept_Swap',          group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.3' },
  { name: 'PE_PRS_SRC_SNK_Transition_to_off',    group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.4' },
  { name: 'PE_PRS_SRC_SNK_Assert_Rd',            group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.5' },
  { name: 'PE_PRS_SRC_SNK_Wait_Source_on',       group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.6' },
  { name: 'PE_PRS_SRC_SNK_Send_Swap',            group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.7' },
  { name: 'PE_PRS_SRC_SNK_Reject_Swap',          group: 'Power Role Swap',    role: 'SRC', section: '8.3.3.18.3.8' },

  // ── Power Role Swap — SNK→SRC ────────────────────────────────────────────
  { name: 'PE_PRS_SNK_SRC_Evaluate_Swap',        group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.2' },
  { name: 'PE_PRS_SNK_SRC_Accept_Swap',          group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.3' },
  { name: 'PE_PRS_SNK_SRC_Transition_to_off',    group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.4' },
  { name: 'PE_PRS_SNK_SRC_Assert_Rp',            group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.4' },
  { name: 'PE_PRS_SNK_SRC_Source_on',            group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.5' },
  { name: 'PE_PRS_SNK_SRC_Send_Swap',            group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.7' },
  { name: 'PE_PRS_SNK_SRC_Reject_Swap',          group: 'Power Role Swap',    role: 'SNK', section: '8.3.3.18.4.8' },

  // ── Fast Role Swap — SRC→SNK ─────────────────────────────────────────────
  { name: 'PE_FRS_SRC_SNK_Evaluate_Swap',        group: 'Fast Role Swap',     role: 'SRC', section: '8.3.3.18.5.2' },
  { name: 'PE_FRS_SRC_SNK_Accept_Swap',          group: 'Fast Role Swap',     role: 'SRC', section: '8.3.3.18.5.3' },
  { name: 'PE_FRS_SRC_SNK_Transition_to_off',    group: 'Fast Role Swap',     role: 'SRC', section: '8.3.3.18.5.4' },
  { name: 'PE_FRS_SRC_SNK_Assert_Rd',            group: 'Fast Role Swap',     role: 'SRC', section: '8.3.3.18.5.5' },
  { name: 'PE_FRS_SRC_SNK_Wait_Source_on',       group: 'Fast Role Swap',     role: 'SRC', section: '8.3.3.18.5.6' },

  // ── Fast Role Swap — SNK→SRC ─────────────────────────────────────────────
  { name: 'PE_FRS_SNK_SRC_Start_AMS',            group: 'Fast Role Swap',     role: 'SNK', section: '8.3.3.18.6.1' },
  { name: 'PE_FRS_SNK_SRC_Send_Swap',            group: 'Fast Role Swap',     role: 'SNK', section: '8.3.3.18.6.2' },
  { name: 'PE_FRS_SNK_SRC_Transition_to_off',    group: 'Fast Role Swap',     role: 'SNK', section: '8.3.3.18.6.3' },
  { name: 'PE_FRS_SNK_SRC_Vbus_Applied',         group: 'Fast Role Swap',     role: 'SNK', section: '8.3.3.18.6.4' },
  { name: 'PE_FRS_SNK_SRC_Assert_Rp',            group: 'Fast Role Swap',     role: 'SNK', section: '8.3.3.18.6.5' },
  { name: 'PE_FRS_SNK_SRC_Source_on',            group: 'Fast Role Swap',     role: 'SNK', section: '8.3.3.18.6.6' },

  // ── Dual-Role Port ───────────────────────────────────────────────────────
  { name: 'PE_DR_SRC_Get_Source_Cap',            group: 'Dual-Role Port',     role: 'SRC', section: '8.3.3.18.7.1'  },
  { name: 'PE_DR_SRC_Give_Sink_Cap',             group: 'Dual-Role Port',     role: 'SRC', section: '8.3.3.18.8.1'  },
  { name: 'PE_DR_SNK_Get_Sink_Cap',              group: 'Dual-Role Port',     role: 'SNK', section: '8.3.3.18.9.1'  },
  { name: 'PE_DR_SNK_Give_Source_Cap',           group: 'Dual-Role Port',     role: 'SNK', section: '8.3.3.18.10.1' },
  { name: 'PE_DR_SRC_Get_Source_Cap_Ext',        group: 'Dual-Role Port',     role: 'SRC', section: '8.3.3.18.11.1' },
  { name: 'PE_DR_SNK_Give_Source_Cap_Ext',       group: 'Dual-Role Port',     role: 'SNK', section: '8.3.3.18.12.1' },
  { name: 'PE_DR_SNK_Get_Sink_Cap_Ext',          group: 'Dual-Role Port',     role: 'SNK', section: '8.3.3.19.13.1' },
  { name: 'PE_DR_SRC_Give_Sink_Cap_Ext',         group: 'Dual-Role Port',     role: 'SRC', section: '8.3.3.19.14.1' },
  { name: 'PE_DR_SRC_Get_Source_Info',           group: 'Dual-Role Port',     role: 'SRC', section: '8.3.3.20.15.1' },
  { name: 'PE_DR_SNK_Give_Source_Info',          group: 'Dual-Role Port',     role: 'SNK', section: '8.3.3.20.16.1' },

  // ── VCONN Swap ───────────────────────────────────────────────────────────
  { name: 'PE_VCS_Send_Swap',                    group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.1' },
  { name: 'PE_VCS_Evaluate_Swap',                group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.2' },
  { name: 'PE_VCS_Accept_Swap',                  group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.3' },
  { name: 'PE_VCS_Reject_Swap',                  group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.4' },
  { name: 'PE_VCS_Wait_For_VCONN',               group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.5' },
  { name: 'PE_VCS_Turn_Off_VCONN',               group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.6' },
  { name: 'PE_VCS_Turn_On_VCONN',                group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.7' },
  { name: 'PE_VCS_Send_Ps_Rdy',                  group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.8' },
  { name: 'PE_VCS_Force_VCONN',                  group: 'VCONN Swap',         role: 'ANY', section: '8.3.3.19.9' },

  // ── VDM Initiator — Discover Identity (Port) ─────────────────────────────
  { name: 'PE_INIT_PORT_VDM_Identity_Request',   group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.1.1' },
  { name: 'PE_INIT_PORT_VDM_Identity_ACKed',     group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.1.2' },
  { name: 'PE_INIT_PORT_VDM_Identity_NAKed',     group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.1.3' },

  // ── VDM Initiator — Discover SVIDs ───────────────────────────────────────
  { name: 'PE_INIT_VDM_SVIDs_Request',           group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.2.1' },
  { name: 'PE_INIT_VDM_SVIDs_ACKed',             group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.2.2' },
  { name: 'PE_INIT_VDM_SVIDs_NAKed',             group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.2.3' },

  // ── VDM Initiator — Discover Modes ───────────────────────────────────────
  { name: 'PE_INIT_VDM_Modes_Request',           group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.3.1' },
  { name: 'PE_INIT_VDM_Modes_ACKed',             group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.3.2' },
  { name: 'PE_INIT_VDM_Modes_NAKed',             group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.3.3' },

  // ── VDM Initiator — Attention ────────────────────────────────────────────
  { name: 'PE_INIT_VDM_Attention_Request',       group: 'VDM Initiator',      role: 'ANY', section: '8.3.3.20.4.1' },

  // ── VDM Responder — Discover Identity ────────────────────────────────────
  { name: 'PE_RESP_VDM_Get_Identity',            group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.1.1' },
  { name: 'PE_RESP_VDM_Send_Identity',           group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.1.2' },
  { name: 'PE_RESP_VDM_Get_Identity_NAK',        group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.1.3' },

  // ── VDM Responder — Discover SVIDs ───────────────────────────────────────
  { name: 'PE_RESP_VDM_Get_SVIDs',               group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.2.1' },
  { name: 'PE_RESP_VDM_Send_SVIDs',              group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.2.2' },
  { name: 'PE_RESP_VDM_Get_SVIDs_NAK',           group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.2.3' },

  // ── VDM Responder — Discover Modes ───────────────────────────────────────
  { name: 'PE_RESP_VDM_Get_Modes',               group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.3.1' },
  { name: 'PE_RESP_VDM_Send_Modes',              group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.3.2' },
  { name: 'PE_RESP_VDM_Get_Modes_NAK',           group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.3.3' },

  // ── VDM Responder — Attention ────────────────────────────────────────────
  { name: 'PE_RCV_VDM_Attention_Request',        group: 'VDM Responder',      role: 'ANY', section: '8.3.3.21.4.1' },

  // ── VDM DFP — Mode Entry ─────────────────────────────────────────────────
  { name: 'PE_DFP_VDM_Mode_Entry_Request',       group: 'VDM DFP',            role: 'DFP', section: '8.3.3.22.1.1' },
  { name: 'PE_DFP_VDM_Mode_Entry_ACKed',         group: 'VDM DFP',            role: 'DFP', section: '8.3.3.22.1.2' },
  { name: 'PE_DFP_VDM_Mode_Entry_NAKed',         group: 'VDM DFP',            role: 'DFP', section: '8.3.3.22.1.3' },

  // ── VDM DFP — Mode Exit ──────────────────────────────────────────────────
  { name: 'PE_DFP_VDM_Mode_Exit_Request',        group: 'VDM DFP',            role: 'DFP', section: '8.3.3.22.2.1' },
  { name: 'PE_DFP_VDM_Mode_Exit_ACKed',          group: 'VDM DFP',            role: 'DFP', section: '8.3.3.22.2.2' },

  // ── VDM UFP — Mode Entry ─────────────────────────────────────────────────
  { name: 'PE_UFP_VDM_Evaluate_Mode_Entry',      group: 'VDM UFP',            role: 'UFP', section: '8.3.3.23.1.1' },
  { name: 'PE_UFP_VDM_Mode_Entry_ACK',           group: 'VDM UFP',            role: 'UFP', section: '8.3.3.23.1.2' },
  { name: 'PE_UFP_VDM_Mode_Entry_NAK',           group: 'VDM UFP',            role: 'UFP', section: '8.3.3.23.1.3' },

  // ── VDM UFP — Mode Exit ──────────────────────────────────────────────────
  { name: 'PE_UFP_VDM_Mode_Exit',                group: 'VDM UFP',            role: 'UFP', section: '8.3.3.23.2.1' },
  { name: 'PE_UFP_VDM_Mode_Exit_ACK',            group: 'VDM UFP',            role: 'UFP', section: '8.3.3.23.2.2' },
  { name: 'PE_UFP_VDM_Mode_Exit_NAK',            group: 'VDM UFP',            role: 'UFP', section: '8.3.3.23.2.3' },

  // ── Cable Plug ───────────────────────────────────────────────────────────
  { name: 'PE_CBL_Ready',                        group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.1.1'   },
  { name: 'PE_CBL_Soft_Reset',                   group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.2.1.1' },
  { name: 'PE_CBL_Hard_Reset',                   group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.2.2.1' },
  { name: 'PE_CBL_Evaluate_Mode_Entry',          group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.4.1.1' },
  { name: 'PE_CBL_Mode_Entry_ACK',               group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.4.1.2' },
  { name: 'PE_CBL_Mode_Entry_NAK',               group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.4.1.3' },
  { name: 'PE_CBL_Mode_Exit',                    group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.4.2.1' },
  { name: 'PE_CBL_Mode_Exit_ACK',                group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.4.2.2' },
  { name: 'PE_CBL_Mode_Exit_NAK',                group: 'Cable Plug',         role: 'CBL', section: '8.3.3.24.4.2.3' },

  // ── Cable Soft/Hard Reset — DFP/VCONN Source ─────────────────────────────
  { name: 'PE_DFP_VCS_CBL_Send_Soft_Reset',      group: 'Cable Plug',         role: 'DFP', section: '8.3.3.24.2.3.1' },
  { name: 'PE_DFP_VCS_CBL_Send_Cable_Reset',     group: 'Cable Plug',         role: 'DFP', section: '8.3.3.24.2.3.2' },

  // ── Cable Soft Reset — UFP/VCONN Source ─────────────────────────────────
  { name: 'PE_UFP_VCS_CBL_Send_Soft_Reset',      group: 'Cable Plug',         role: 'UFP', section: '8.3.3.24.2.4.1' },

  // ── Source Startup — Cable VDM Identity ──────────────────────────────────
  { name: 'PE_SRC_VDM_Identity_Request',         group: 'Cable Plug',         role: 'SRC', section: '8.3.3.24.3.1' },
  { name: 'PE_SRC_VDM_Identity_ACKed',           group: 'Cable Plug',         role: 'SRC', section: '8.3.3.24.3.2' },
  { name: 'PE_SRC_VDM_Identity_NAKed',           group: 'Cable Plug',         role: 'SRC', section: '8.3.3.24.3.3' },

  // ── EPR Mode — Source Entry ───────────────────────────────────────────────
  { name: 'PE_SRC_Evaluate_EPR_Mode_Entry',      group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.1.1' },
  { name: 'PE_SRC_EPR_Mode_Entry_Ack',           group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.1.2' },
  { name: 'PE_SRC_EPR_Mode_Discover_Cable',      group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.1.3' },
  { name: 'PE_SRC_EPR_Mode_Evaluate_Cable_EPR',  group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.1.4' },
  { name: 'PE_SRC_EPR_Mode_Entry_Succeeded',     group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.1.5' },
  { name: 'PE_SRC_EPR_Mode_Entry_Failed',        group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.1.6' },

  // ── EPR Mode — Sink Entry ─────────────────────────────────────────────────
  { name: 'PE_SNK_Send_EPR_Mode_Entry',          group: 'EPR Mode',           role: 'SNK', section: '8.3.3.25.2.1' },
  { name: 'PE_SNK_EPR_Mode_Wait_For_Response',   group: 'EPR Mode',           role: 'SNK', section: '8.3.3.25.2.2' },

  // ── EPR Mode — Source Exit ────────────────────────────────────────────────
  { name: 'PE_SRC_Send_EPR_Mode_Exit',           group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.3.1' },
  { name: 'PE_SRC_EPR_Mode_Exit_Received',       group: 'EPR Mode',           role: 'SRC', section: '8.3.3.25.3.2' },

  // ── EPR Mode — Sink Exit ──────────────────────────────────────────────────
  { name: 'PE_SNK_Send_EPR_Mode_Exit',           group: 'EPR Mode',           role: 'SNK', section: '8.3.3.25.4.1' },
  { name: 'PE_SNK_EPR_Mode_Exit_Received',       group: 'EPR Mode',           role: 'SNK', section: '8.3.3.25.4.2' },

  // ── BIST ─────────────────────────────────────────────────────────────────
  { name: 'PE_BIST_Carrier_Mode',                group: 'BIST',               role: 'ANY', section: '8.3.3.26.1.1' },
  { name: 'PE_BIST_Test_Mode',                   group: 'BIST',               role: 'ANY', section: '8.3.3.27.2'   },
  { name: 'PE_BIST_Shared_Capacity_Test_Mode',   group: 'BIST',               role: 'ANY', section: '8.3.3.27.3'   },

  // ── USB Type-C referenced ─────────────────────────────────────────────────
  { name: 'ErrorRecovery',                       group: 'USB Type-C',         role: 'ANY', section: '8.3.3.27.1' },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Fast O(1) map: state name → PeState */
const _byName = new Map<string, PeState>(PE_STATES.map(s => [s.name, s]));

/** Look up a PE state by its exact name. Returns undefined if not found. */
export function lookupPeState(name: string): PeState | undefined {
  return _byName.get(name);
}

/** All unique group names, in declaration order. */
export const PE_GROUPS: readonly string[] = [...new Set(PE_STATES.map(s => s.group))];

/** Filter states by group name. */
export function getPeStatesByGroup(group: string): readonly PeState[] {
  return PE_STATES.filter(s => s.group === group);
}

/** Filter states by role. 'ANY' role states are included when filtering for any specific role. */
export function getPeStatesByRole(role: PeRole): readonly PeState[] {
  return PE_STATES.filter(s => s.role === role || s.role === 'ANY');
}

/** Total number of states. */
export const PE_STATE_COUNT = PE_STATES.length;
