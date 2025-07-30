const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function run() {
  try {
    const serviceKey = core.getInput('service-key', { required: true });
    const autoCleanup = core.getInput('auto-cleanup') === 'true';
    
    // Store cleanup state
    core.exportVariable('TWINGATE_CLEANUP_ENABLED', autoCleanup.toString());
    core.exportVariable('TWINGATE_OS', process.platform);
    core.exportVariable('TWINGATE_SETUP_ATTEMPTED', 'true');
    
    core.info('🚀 Setting up Twingate connection...');
    
    if (process.platform === 'linux') {
      await setupLinux(serviceKey);
    } else if (process.platform === 'win32') {
      await setupWindows(serviceKey);
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }
    
    core.info('✅ Twingate connection established successfully');
    
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

async function setupLinux(serviceKey) {
  try {
    core.info('Installing Twingate client for Linux...');
    
    // Install Twingate using the official method from Twingate documentation
    await exec.exec('sudo', ['apt-get', 'update', '-qq']);
    await exec.exec('sudo', ['apt-get', 'install', '-y', 'curl', 'gnupg', 'ca-certificates']);
    
    // Use the official Twingate GPG key and repository
    await exec.exec('bash', ['-c', 'curl -fsSL https://packages.twingate.com/apt/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/twingate-client-keyring.gpg']);
    await exec.exec('bash', ['-c', 'echo "deb [signed-by=/usr/share/keyrings/twingate-client-keyring.gpg] https://packages.twingate.com/apt/ * *" | sudo tee /etc/apt/sources.list.d/twingate.list']);
    await exec.exec('sudo', ['apt-get', 'update', '-yq']);
    await exec.exec('sudo', ['apt-get', 'install', '-yq', 'twingate']);
    
    core.exportVariable('TWINGATE_INSTALLED', 'true');
    
    // Setup and start Twingate
    core.info('Setting up and starting Twingate service...');
    
    // Write service key to file
    const keyPath = path.join(os.tmpdir(), 'twingate-key.json');
    await fs.writeFile(keyPath, serviceKey);
    
    await exec.exec('sudo', ['twingate', 'setup', '--headless', keyPath]);
    
    // Start with retry logic
    const maxRetries = 5;
    let waitTime = 5;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      core.info(`Starting Twingate service (attempt ${attempt + 1}/${maxRetries})...`);
      
      try {
        await exec.exec('sudo', ['twingate', 'config', 'log-level', 'info']);
        await exec.exec('twingate', ['start']);
        
        core.info(`Waiting ${waitTime} seconds for Twingate service to start...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        
        // Check status
        let status = '';
        await exec.exec('twingate', ['status'], {
          listeners: {
            stdout: (data) => {
              status += data.toString().trim();
            }
          }
        });
        
        core.info(`Twingate service status: '${status}'`);
        
        if (status === 'online') {
          core.info('Twingate service is connected.');
          await exec.exec('twingate', ['resources']);
          await exec.exec('sudo', ['journalctl', '-u', 'twingate', '--no-pager']);
          core.exportVariable('TWINGATE_CONNECTED', 'true');
          break;
        } else {
          await exec.exec('twingate', ['stop']);
          await exec.exec('sudo', ['journalctl', '-u', 'twingate', '--no-pager']);
        }
        
      } catch (error) {
        core.warning(`Attempt ${attempt + 1} failed: ${error.message}`);
      }
      
      if (attempt === maxRetries - 1) {
        throw new Error('Twingate service failed to connect after maximum retries');
      }
      
      waitTime += 5;
      core.info('Twingate service is not connected. Retrying...');
    }
    
    // Clean up temporary key file
    await fs.unlink(keyPath).catch(() => {});
    
  } catch (error) {
    throw new Error(`Linux setup failed: ${error.message}`);
  }
}

async function setupWindows(serviceKey) {
  try {
    core.info('Installing Twingate client for Windows...');
    
    // Download and install Twingate
    await exec.exec('powershell', [
      '-Command',
      'Invoke-WebRequest https://api.twingate.com/download/windows?installer=msi -OutFile .\\twingate_client.msi'
    ]);
    
    // Write service key to file
    const keyPath = path.join(process.cwd(), 'key.json');
    await fs.writeFile(keyPath, serviceKey);
    
    // Install MSI with service key
    await exec.exec('powershell', [
      '-Command',
      `Start-Process msiexec.exe -Wait -ArgumentList "/i twingate_client.msi service_secret=${keyPath} /quiet"`
    ]);
    
    // Start service
    await exec.exec('powershell', ['-Command', 'Start-Service twingate.service']);
    await exec.exec('powershell', ['-Command', 'Start-Sleep -Seconds 10']);
    await exec.exec('powershell', ['-Command', 'Get-Service twingate.service']);
    
    core.exportVariable('TWINGATE_CONNECTED', 'true');
    
    // Clean up temporary key file
    await fs.unlink(keyPath).catch(() => {});
    
  } catch (error) {
    throw new Error(`Windows setup failed: ${error.message}`);
  }
}

run();
