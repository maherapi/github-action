// @ts-check
const core = require('@actions/core');
const exec = require('@actions/exec');

async function cleanup() {
  try {
    const cleanupEnabled = process.env.TWINGATE_CLEANUP_ENABLED === 'true';
    const setupAttempted = process.env.TWINGATE_SETUP_ATTEMPTED === 'true';
    const platform = process.env.TWINGATE_OS || process.platform;
    
    if (!cleanupEnabled || !setupAttempted) {
      core.info('Twingate cleanup skipped (not enabled or setup not attempted)');
      return;
    }
    
    core.info('🧹 Starting Twingate cleanup...');
    
    if (platform === 'linux') {
      await cleanupLinux();
    } else if (platform === 'win32' || platform === 'Windows') {
      await cleanupWindows();
    } else {
      core.warning(`Cleanup not supported for platform: ${platform}`);
      return;
    }
    
    core.info('🔒 Twingate connection cleanup process completed');
    core.info('Connection was properly terminated before workflow finish');
    
  } catch (error) {
    core.warning(`Cleanup encountered an issue: ${error.message}`);
    // Don't fail the action on cleanup errors
  }
}

async function cleanupLinux() {
  try {
    core.info('🧹 Starting Twingate cleanup for Linux...');
    
    // Stop Twingate service gracefully
    try {
      const { exitCode } = await exec.getExecOutput('which', ['twingate'], { ignoreReturnCode: true });
      if (exitCode === 0) {
        core.info('Stopping Twingate client...');
        await exec.exec('twingate', ['stop'], { ignoreReturnCode: true });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      }
    } catch (error) {
      core.debug(`Twingate stop command failed: ${error.message}`);
    }
    
    // Stop systemd service if running
    try {
      const { exitCode } = await exec.getExecOutput('systemctl', ['is-active', 'twingate'], { ignoreReturnCode: true });
      if (exitCode === 0) {
        core.info('Stopping Twingate systemd service...');
        await exec.exec('sudo', ['systemctl', 'stop', 'twingate'], { ignoreReturnCode: true });
      }
    } catch (error) {
      core.debug(`Systemctl stop failed: ${error.message}`);
    }
    
    // Kill any remaining Twingate processes
    core.info('Terminating any remaining Twingate processes...');
    await exec.exec('sudo', ['pkill', '-f', 'twingate'], { ignoreReturnCode: true });
    
    // Clean up any Twingate network interfaces
    try {
      const { stdout } = await exec.getExecOutput('ip', ['link', 'show'], { ignoreReturnCode: true });
      const interfaces = stdout.match(/utun\d+/g) || [];
      
      for (const iface of interfaces) {
        core.info(`Removing network interface: ${iface}`);
        await exec.exec('sudo', ['ip', 'link', 'delete', iface], { ignoreReturnCode: true });
      }
    } catch (error) {
      core.debug(`Network interface cleanup failed: ${error.message}`);
    }
    
    core.info('✅ Linux Twingate cleanup completed');
    
  } catch (error) {
    throw new Error(`Linux cleanup failed: ${error.message}`);
  }
}

async function cleanupWindows() {
  try {
    core.info('🧹 Starting Twingate cleanup for Windows...');
    
    // Stop Twingate service
    core.info('Stopping Twingate service...');
    await exec.exec('powershell', [
      '-Command',
      'Stop-Service -Name "twingate.service" -Force -ErrorAction SilentlyContinue'
    ], { ignoreReturnCode: true });
    
    // Wait a moment for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Kill any remaining Twingate processes
    core.info('Terminating any remaining Twingate processes...');
    await exec.exec('powershell', [
      '-Command',
      'Get-Process -Name "*twingate*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue'
    ], { ignoreReturnCode: true });
    
    core.info('✅ Windows Twingate cleanup completed');
    
  } catch (error) {
    throw new Error(`Windows cleanup failed: ${error.message}`);
  }
}

cleanup();
