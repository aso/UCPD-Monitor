# client/src/store/appStore.js

## Role
The central state management hub for the entire application, implemented using **Zustand**.

## Key Responsibilities
- **Global State Management**: Maintains the single source of truth for the application's state, including topology, connection status, and parsed data.
- **Topology State**: Tracks the current state of the USB-PD connection, including:
    - **Source/Sink Capabilities**: PDOs, RDOs, and protocol capabilities.
    - **eMarker Information**: Cable properties, EPR capability, and active status.
    - **Connection Events**: Attachment/Detachment events and role swaps.
- **Data Processing**: Integrates with the `pd_parser.ts` to decode incoming raw frames and update the topology state.
- **State Transitions**: Implements a pure state-machine logic (`applyFrameToTopo`) that takes a decoded frame and the current topology to produce a new, updated topology.

## Key Data Structures
- `INITIAL_TOPOLOGY`: Defines the default, empty state for the connection (Source, Sink, eMarker, Cable, etc.).
- `applyFrameToTopo(topo, frame)`: The core logic function that handles state transitions based on different record types (e.g., `EVENT`, `ASCII_LOG`, `CPD_FRAME`).

## Key Features
- **Reactive Updates**: Since it uses Zustand, any component subscribing to this store automatically re-renders when the topology changes.
- **Replay Support**: The state-machine approach allows the application to "replay" historical data from `.cpd` files by feeding them through the same logic used for live WebSocket streams.

