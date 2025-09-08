#!/usr/bin/env python3
"""
Mumble Link Helper for Foundry VTT
This helper application bridges the gap between the web-based FVTT and Mumble's Link plugin
by providing a WebSocket server that can write to the memory-mapped file.
"""

import asyncio
import json
import mmap
import struct
import websockets
import logging
from pathlib import Path
import sys
import platform

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MumbleLinkHelper:
    def __init__(self):
        self.clients = set()
        self.mumble_link = None
        self.link_name = self._get_link_name()
        
    def _get_link_name(self):
        """Get the appropriate memory-mapped file name for the current platform"""
        system = platform.system()
        if system == "Windows":
            return "MumbleLink"
        elif system == "Linux":
            return "/dev/shm/MumbleLink.{uid}".format(uid=os.getuid())
        elif system == "Darwin":  # macOS
            return "/tmp/MumbleLink.{uid}".format(uid=os.getuid())
        else:
            logger.error(f"Unsupported platform: {system}")
            return None

    async def initialize_mumble_link(self):
        """Initialize connection to Mumble Link plugin"""
        try:
            if platform.system() == "Windows":
                # On Windows, we need to use CreateFileMapping/MapViewOfFile
                import ctypes
                from ctypes import wintypes
                
                kernel32 = ctypes.windll.kernel32
                
                # Try to open existing mapping
                handle = kernel32.OpenFileMappingW(
                    0x1F,  # FILE_MAP_ALL_ACCESS
                    False,
                    self.link_name
                )
                
                if not handle:
                    logger.warning("Mumble Link not found. Make sure Mumble is running with Link plugin enabled.")
                    return False
                
                # Map view of file
                self.mumble_memory = kernel32.MapViewOfFile(
                    handle, 0x1F, 0, 0, 2048  # 2KB for the link structure
                )
                
                if not self.mumble_memory:
                    logger.error("Failed to map Mumble Link memory")
                    return False
                    
            else:
                # Unix-like systems
                if not Path(self.link_name).exists():
                    logger.warning("Mumble Link not found. Make sure Mumble is running with Link plugin enabled.")
                    return False
                    
                with open(self.link_name, 'r+b') as f:
                    self.mumble_memory = mmap.mmap(f.fileno(), 2048)
            
            logger.info("Successfully connected to Mumble Link")
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize Mumble Link: {e}")
            return False

    def update_mumble_link(self, data):
        """Update the Mumble Link memory with position data"""
        if not self.mumble_memory:
            return
            
        try:
            # Pack the data according to Mumble Link structure
            # struct LinkedMem {
            #     UINT32 uiVersion;
            #     DWORD uiTick;
            #     float fAvatarPosition[3];
            #     float fAvatarFront[3];
            #     float fAvatarTop[3];
            #     wchar_t name[256];
            #     float fCameraPosition[3];
            #     float fCameraFront[3];
            #     float fCameraTop[3];
            #     wchar_t identity[256];
            #     UINT32 context_len;
            #     unsigned char context[256];
            #     wchar_t description[2048];
            # };
            
            # Start building the binary data
            binary_data = bytearray(2048)
            offset = 0
            
            # uiVersion (4 bytes)
            struct.pack_into('<I', binary_data, offset, data.get('uiVersion', 4))
            offset += 4
            
            # uiTick (4 bytes) - increment counter
            tick = struct.unpack_from('<I', binary_data, offset)[0] + 1
            struct.pack_into('<I', binary_data, offset, tick)
            offset += 4
            
            # Avatar position (12 bytes - 3 floats)
            pos = data.get('fAvatarPosition', [0, 0, 0])
            for i in range(3):
                struct.pack_into('<f', binary_data, offset, pos[i])
                offset += 4
                
            # Avatar front (12 bytes - 3 floats)
            front = data.get('fAvatarFront', [0, 0, 1])
            for i in range(3):
                struct.pack_into('<f', binary_data, offset, front[i])
                offset += 4
                
            # Avatar top (12 bytes - 3 floats)
            top = data.get('fAvatarTop', [0, 1, 0])
            for i in range(3):
                struct.pack_into('<f', binary_data, offset, top[i])
                offset += 4
            
            # Name (512 bytes - 256 wide chars)
            name = data.get('name', 'Foundry VTT User')[:255]
            name_wide = name.encode('utf-16le')[:510]  # Leave room for null terminator
            binary_data[offset:offset+len(name_wide)] = name_wide
            offset += 512
            
            # Camera position (12 bytes - 3 floats)
            cam_pos = data.get('fCameraPosition', pos)
            for i in range(3):
                struct.pack_into('<f', binary_data, offset, cam_pos[i])
                offset += 4
                
            # Camera front (12 bytes - 3 floats)
            cam_front = data.get('fCameraFront', front)
            for i in range(3):
                struct.pack_into('<f', binary_data, offset, cam_front[i])
                offset += 4
                
            # Camera top (12 bytes - 3 floats)
            cam_top = data.get('fCameraTop', top)
            for i in range(3):
                struct.pack_into('<f', binary_data, offset, cam_top[i])
                offset += 4
            
            # Identity (512 bytes - 256 wide chars)
            identity = data.get('identity', '{}')[:255]
            identity_wide = identity.encode('utf-16le')[:510]
            binary_data[offset:offset+len(identity_wide)] = identity_wide
            offset += 512
            
            # Context length (4 bytes)
            context = data.get('context', [])
            context_len = min(len(context), 256)
            struct.pack_into('<I', binary_data, offset, context_len)
            offset += 4
            
            # Context data (256 bytes)
            if context:
                context_bytes = bytes(context[:256])
                binary_data[offset:offset+len(context_bytes)] = context_bytes
            offset += 256
            
            # Description (4096 bytes - 2048 wide chars)
            description = data.get('description', 'Foundry VTT')[:2047]
            desc_wide = description.encode('utf-16le')[:4094]
            binary_data[offset:offset+len(desc_wide)] = desc_wide
            
            # Write to memory
            if platform.system() == "Windows":
                ctypes.memmove(self.mumble_memory, binary_data, len(binary_data))
            else:
                self.mumble_memory.seek(0)
                self.mumble_memory.write(binary_data)
                self.mumble_memory.flush()
                
        except Exception as e:
            logger.error(f"Failed to update Mumble Link: {e}")

    async def handle_client(self, websocket, path):
        """Handle WebSocket client connections from FVTT"""
        logger.info(f"New client connected: {websocket.remote_address}")
        self.clients.add(websocket)
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    self.update_mumble_link(data)
                    logger.debug(f"Updated Mumble Link with: {data.get('name', 'Unknown')}")
                    
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON received: {message}")
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    
        except websockets.exceptions.ConnectionClosed:
            logger.info("Client disconnected")
        finally:
            self.clients.remove(websocket)

    async def start_server(self, host='localhost', port=23456):
        """Start the WebSocket server"""
        if not await self.initialize_mumble_link():
            logger.error("Failed to connect to Mumble Link. Exiting.")
            return
            
        logger.info(f"Starting Mumble Link Helper server on {host}:{port}")
        
        async with websockets.serve(self.handle_client, host, port):
            logger.info("Server started. Waiting for connections from Foundry VTT...")
            await asyncio.Future()  # Run forever

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Mumble Link Helper for Foundry VTT')
    parser.add_argument('--host', default='localhost', help='Host to bind to')
    parser.add_argument('--port', type=int, default=23456, help='Port to bind to')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    
    args = parser.parse_args()
    
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
    
    helper = MumbleLinkHelper()
    
    try:
        asyncio.run(helper.start_server(args.host, args.port))
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()