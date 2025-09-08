/**
 * Foundry VTT - Mumble Positional Audio Integration
 * Integrates token positions with Mumble's Link plugin for positional audio
 */

class MumblePositionalAudio {
    static ID = 'mumble-positional-audio';
    static NAME = 'Mumble Positional Audio';
    static TEMPLATE_PATH = `modules/${this.ID}/templates/`;
    
    // Mumble Link plugin memory-mapped file structure
    static LINK_STRUCT = {
      uiVersion: 4,
      dwcount: 0,
      fAvatarPosition: [0, 0, 0],    // Player position (x, y, z)
      fAvatarFront: [0, 0, 1],       // Player facing direction
      fAvatarTop: [0, 1, 0],         // Player up vector
      name: '',                      // Player name
      fCameraPosition: [0, 0, 0],    // Camera position
      fCameraFront: [0, 0, 1],       // Camera facing direction
      fCameraTop: [0, 1, 0],         // Camera up vector
      identity: '',                  // JSON identity string
      context_len: 0,
      context: new Uint8Array(256),  // Context data
      description: 'Foundry VTT'     // Application description
    };
  
    static settings = {
      enabled: {
        name: 'Enable Positional Audio',
        hint: 'Enable integration with Mumble positional audio',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
      },
      updateRate: {
        name: 'Update Rate (ms)',
        hint: 'How often to update position data to Mumble (in milliseconds)',
        scope: 'client',
        config: true,
        type: Number,
        default: 100,
        range: { min: 50, max: 1000, step: 50 }
      },
      audioRange: {
        name: 'Audio Range',
        hint: 'Maximum distance for positional audio (in grid units)',
        scope: 'client',
        config: true,
        type: Number,
        default: 50
      },
      scaleMultiplier: {
        name: 'Scale Multiplier',
        hint: 'Multiplier for converting FVTT coordinates to audio space',
        scope: 'client',
        config: true,
        type: Number,
        default: 0.1
      }
    };
  
    static init() {
      console.log(`${this.NAME} | Initializing module`);
      
      // Register settings
      for (const [key, setting] of Object.entries(this.settings)) {
        game.settings.register(this.ID, key, setting);
      }
  
      // Initialize the module when ready
      Hooks.once('ready', this.onReady.bind(this));
    }
  
    static onReady() {
      if (!game.settings.get(this.ID, 'enabled')) {
        console.log(`${this.NAME} | Module disabled in settings`);
        return;
      }
  
      this.initializeMumbleLink();
      this.startPositionUpdates();
      this.registerHooks();
      
      console.log(`${this.NAME} | Module ready and active`);
    }
  
    static initializeMumbleLink() {
      // Check if we can access the Mumble Link plugin
      try {
        // Create a shared memory interface (this would need platform-specific implementation)
        this.mumbleLink = this.createMumbleLinkInterface();
        
        if (this.mumbleLink) {
          console.log(`${this.NAME} | Connected to Mumble Link plugin`);
          
          // Set initial application info
          this.updateMumbleIdentity();
          this.updateMumbleContext();
        }
      } catch (error) {
        console.warn(`${this.NAME} | Failed to connect to Mumble Link plugin:`, error);
        ui.notifications.warn("Mumble Link plugin not detected. Positional audio will not work.");
      }
    }
  
    static createMumbleLinkInterface() {
      // This would need to be implemented differently based on the platform
      // For web-based FVTT, we might need to use a local helper application
      // or browser extension to interface with the memory-mapped file
      
      if (typeof window.electronAPI !== 'undefined') {
        // Electron app - can potentially access system resources
        return this.createElectronMumbleLink();
      } else {
        // Web browser - would need a helper application or extension
        return this.createWebMumbleLink();
      }
    }
  
    static createElectronMumbleLink() {
      // Placeholder for Electron implementation
      // Would use node.js modules to access memory-mapped files
      console.warn(`${this.NAME} | Electron Mumble Link not yet implemented`);
      return null;
    }
  
    static createWebMumbleLink() {
      // Placeholder for web implementation
      // Could use WebSocket to communicate with a local helper app
      console.log(`${this.NAME} | Attempting to connect to local Mumble Link helper...`);
      
      try {
        const ws = new WebSocket('ws://localhost:23456');
        
        ws.onopen = () => {
          console.log(`${this.NAME} | Connected to Mumble Link helper`);
        };
        
        ws.onerror = (error) => {
          console.warn(`${this.NAME} | WebSocket connection failed:`, error);
        };
        
        return {
          send: (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(data));
            }
          },
          close: () => ws.close()
        };
      } catch (error) {
        console.warn(`${this.NAME} | Failed to create WebSocket connection:`, error);
        return null;
      }
    }
  
    static startPositionUpdates() {
      const updateRate = game.settings.get(this.ID, 'updateRate');
      
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
      
      this.updateInterval = setInterval(() => {
        this.updatePositionalAudio();
      }, updateRate);
    }
  
    static updatePositionalAudio() {
      if (!this.mumbleLink || !game.user.character) {
        return;
      }
  
      const token = game.user.character.getActiveTokens()[0];
      if (!token) {
        return;
      }
  
      const scaleMultiplier = game.settings.get(this.ID, 'scaleMultiplier');
      const scene = game.scenes.active;
      
      if (!scene) return;
  
      // Get token position and convert to audio coordinates
      const tokenPos = {
        x: token.x + (token.width * scene.dimensions.size) / 2,
        y: token.y + (token.height * scene.dimensions.size) / 2
      };
  
      // Convert FVTT coordinates to 3D audio space
      // FVTT uses top-left origin, audio typically uses center origin
      const audioPos = [
        (tokenPos.x - scene.dimensions.width / 2) * scaleMultiplier,
        0, // Y is up in audio space, keep at 0 for 2D maps
        (tokenPos.y - scene.dimensions.height / 2) * scaleMultiplier
      ];
  
      // Get token rotation for facing direction
      const rotation = token.rotation || 0;
      const radians = (rotation * Math.PI) / 180;
      
      const facing = [
        Math.sin(radians),
        0,
        Math.cos(radians)
      ];
  
      // Update Mumble Link data
      const linkData = {
        fAvatarPosition: audioPos,
        fAvatarFront: facing,
        fAvatarTop: [0, 1, 0],
        fCameraPosition: audioPos,
        fCameraFront: facing,
        fCameraTop: [0, 1, 0],
        name: game.user.name,
        identity: JSON.stringify({
          name: game.user.name,
          scene: scene.name,
          character: game.user.character.name
        })
      };
  
      this.sendToMumbleLink(linkData);
    }
  
    static sendToMumbleLink(data) {
      if (this.mumbleLink && this.mumbleLink.send) {
        this.mumbleLink.send(data);
      }
    }
  
    static updateMumbleIdentity() {
      const identity = {
        name: game.user.name,
        world: game.world.title,
        scene: game.scenes.active?.name || 'Unknown',
        character: game.user.character?.name || 'No Character'
      };
  
      this.sendToMumbleLink({
        identity: JSON.stringify(identity)
      });
    }
  
    static updateMumbleContext() {
      // Context helps Mumble know which users should hear each other
      const context = {
        world: game.world.id,
        scene: game.scenes.active?.id || 'none'
      };
  
      const contextString = JSON.stringify(context);
      const contextBytes = new TextEncoder().encode(contextString);
      
      this.sendToMumbleLink({
        context: Array.from(contextBytes),
        context_len: contextBytes.length
      });
    }
  
    static registerHooks() {
      // Update position when token moves
      Hooks.on('updateToken', (tokenDocument, changes, options, userId) => {
        if (tokenDocument.actor?.id === game.user.character?.id) {
          this.updatePositionalAudio();
        }
      });
  
      // Update context when scene changes
      Hooks.on('canvasReady', () => {
        this.updateMumbleContext();
        this.updateMumbleIdentity();
      });
  
      // Update identity when character changes
      Hooks.on('updateUser', (user, changes) => {
        if (user.id === game.user.id && 'character' in changes) {
          this.updateMumbleIdentity();
        }
      });
  
      // Clean up on logout
      Hooks.on('signOut', () => {
        this.cleanup();
      });
    }
  
    static cleanup() {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }
      
      if (this.mumbleLink && this.mumbleLink.close) {
        this.mumbleLink.close();
      }
    }
  }
  
  // Initialize the module
  Hooks.once('init', MumblePositionalAudio.init.bind(MumblePositionalAudio));