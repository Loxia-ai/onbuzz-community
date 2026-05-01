/**
 * Context Injection Service
 * Builds dynamic context sections from active file attachments
 */

import FileAttachmentService from './fileAttachmentService.js';
import registry from './serviceRegistry.js';

class ContextInjectionService {
  constructor(config = {}, logger = null) {
    this.config = config;
    this.logger = logger;
    this.attachmentService = new FileAttachmentService(config, logger);
  }

  /**
   * Initialize service
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.attachmentService.initialize();
  }

  /**
   * Build dynamic context for an agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<string>} Dynamic context section
   */
  async buildDynamicContext(agentId) {
    try {
      const activeAttachments = await this.attachmentService.getActiveAttachments(agentId);

      if (activeAttachments.length === 0) {
        return ''; // No context to inject
      }

      // Separate content and reference mode attachments
      const contentFiles = activeAttachments.filter(a => a.mode === 'content');
      const referenceFiles = activeAttachments.filter(a => a.mode === 'reference');

      let contextSection = '';

      // Build content files section
      if (contentFiles.length > 0) {
        contextSection += '\n<attached-files>\n';

        for (const attachment of contentFiles) {
          const content = await this.attachmentService.getAttachmentContent(attachment.fileId);
          if (content) {
            const formattedContent = this.formatContentFile(attachment, content);
            contextSection += formattedContent + '\n';
          }
        }

        contextSection += '</attached-files>\n';
      }

      // Build reference files section
      if (referenceFiles.length > 0) {
        contextSection += '\n<file-references>\n';

        for (const attachment of referenceFiles) {
          const formattedRef = this.formatReferenceFile(attachment);
          contextSection += formattedRef + '\n';
        }

        contextSection += '</file-references>\n';
        contextSection += '\nNote: Referenced files can be accessed using the filesystem tool if needed.\n';
      }

      return contextSection;
    } catch (error) {
      this.logger?.error('Error building dynamic context', { agentId, error: error.message });
      return ''; // Return empty on error to avoid breaking the conversation
    }
  }

  /**
   * Format content mode file
   * @param {Object} attachment - Attachment metadata
   * @param {string} content - File content
   * @returns {string} Formatted XML
   */
  formatContentFile(attachment, content) {
    const { fileName, fileType, size, contentType } = attachment;
    const sizeKB = (size / 1024).toFixed(2);

    // Format based on content type
    if (contentType === 'text') {
      return this.formatTextFile(attachment, content);
    } else if (contentType === 'image') {
      return this.formatImageFile(attachment, content);
    } else if (contentType === 'pdf') {
      return this.formatPdfFile(attachment, content);
    }

    // Fallback
    return `  <file name="${this.escapeXml(fileName)}" type="${fileType}" size="${sizeKB}KB" mode="content">\n${this.escapeXml(content)}\n  </file>`;
  }

  /**
   * Format text file
   * @param {Object} attachment - Attachment metadata
   * @param {string} content - File content
   * @returns {string} Formatted XML
   */
  formatTextFile(attachment, content) {
    const { fileName, fileType, size } = attachment;
    const sizeKB = (size / 1024).toFixed(2);

    return `  <file name="${this.escapeXml(fileName)}" type="${fileType}" size="${sizeKB}KB" mode="content">\n${this.escapeXml(content)}\n  </file>`;
  }

  /**
   * Format image file
   * @param {Object} attachment - Attachment metadata
   * @param {string} base64Content - Base64 data URI
   * @returns {string} Formatted XML
   */
  formatImageFile(attachment, base64Content) {
    const { fileName, fileType, size } = attachment;
    const sizeKB = (size / 1024).toFixed(2);

    return `  <file name="${this.escapeXml(fileName)}" type="${fileType}" size="${sizeKB}KB" mode="content">\n${base64Content}\n  </file>`;
  }

  /**
   * Format PDF file
   * @param {Object} attachment - Attachment metadata
   * @param {string} extractedText - Extracted text from PDF
   * @returns {string} Formatted XML
   */
  formatPdfFile(attachment, extractedText) {
    const { fileName, fileType, size } = attachment;
    const sizeKB = (size / 1024).toFixed(2);

    return `  <file name="${this.escapeXml(fileName)}" type="${fileType}" size="${sizeKB}KB" mode="content">\n${this.escapeXml(extractedText)}\n  </file>`;
  }

  /**
   * Format reference mode file
   * @param {Object} attachment - Attachment metadata
   * @returns {string} Formatted XML
   */
  formatReferenceFile(attachment) {
    const { fileName, originalPath, size, fileType, lastModified } = attachment;
    const sizeFormatted = this.formatBytes(size);
    const modifiedDate = new Date(lastModified).toISOString().split('T')[0];

    return `  <file name="${this.escapeXml(fileName)}" path="${this.escapeXml(originalPath)}" size="${sizeFormatted}" type="${fileType}" modified="${modifiedDate}" />`;
  }

  /**
   * Escape XML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeXml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes
   * @returns {string}
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
  }

  /**
   * Estimate total tokens for active attachments
   * @param {string} agentId - Agent ID
   * @returns {Promise<number>} Total estimated tokens
   */
  async estimateTotalTokens(agentId) {
    try {
      const activeAttachments = await this.attachmentService.getActiveAttachments(agentId);
      let total = 0;

      for (const attachment of activeAttachments) {
        if (attachment.mode === 'content') {
          total += attachment.tokenEstimate || 0;
        } else {
          // Reference mode: estimate XML tag overhead
          total += 20; // Approximate tokens for XML tag
        }
      }

      return total;
    } catch (error) {
      this.logger?.error('Error estimating total tokens', { agentId, error: error.message });
      return 0;
    }
  }

  /**
   * Get summary of active attachments
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} Summary object
   */
  async getAttachmentSummary(agentId) {
    try {
      const activeAttachments = await this.attachmentService.getActiveAttachments(agentId);

      const summary = {
        totalActive: activeAttachments.length,
        contentMode: activeAttachments.filter(a => a.mode === 'content').length,
        referenceMode: activeAttachments.filter(a => a.mode === 'reference').length,
        estimatedTokens: 0,
        files: []
      };

      for (const attachment of activeAttachments) {
        summary.estimatedTokens += attachment.tokenEstimate || 0;
        summary.files.push({
          fileName: attachment.fileName,
          mode: attachment.mode,
          size: this.formatBytes(attachment.size),
          tokens: attachment.tokenEstimate || 0
        });
      }

      return summary;
    } catch (error) {
      this.logger?.error('Error getting attachment summary', { agentId, error: error.message });
      return {
        totalActive: 0,
        contentMode: 0,
        referenceMode: 0,
        estimatedTokens: 0,
        files: []
      };
    }
  }
  /**
   * Build system environment constraints to inject into the system prompt.
   * Includes reserved ports and process safety rules.
   * @returns {string} Constraints context string (empty if none)
   */
  buildSystemConstraints() {
    try {
      const allServices = registry.getAll();
      const usedPorts = [...new Set(Object.values(allServices).map(s => s.port))].filter(Boolean);

      if (usedPorts.length === 0) {
        return '';
      }

      return `\n\nIMPORTANT SYSTEM CONSTRAINT: This system is running on ports: ${usedPorts.join(', ')}. Do not use them in the code you write nor in servers you set up. Also, never kill node.exe/nodejs processes.`;
    } catch (error) {
      this.logger?.warn('Failed to build system constraints', { error: error.message });
      return '';
    }
  }

  /**
   * Build a "Current local time" line to prepend to the per-turn system
   * prompt. Re-evaluated on every turn so the agent always sees the time
   * the model is actually answering at, not the time the agent was created.
   *
   * Format: "Current local time: hh:mm dd/mm/yyyy" — fixed, one line.
   * Locale-independent because LLMs do not need surprises across locales:
   * agents reasoning about "now is past 17:00, schedule for tomorrow" should
   * get the same shape regardless of where the host runs.
   *
   * @param {Date} [now] override for tests
   * @returns {string} Empty string if `now` is not a valid Date.
   */
  buildCurrentTimeContext(now = new Date()) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const dd = pad(now.getDate());
    const mo = pad(now.getMonth() + 1);
    const yy = now.getFullYear();
    return `\n\nCurrent local time: ${hh}:${mm} ${dd}/${mo}/${yy}`;
  }
}

export default ContextInjectionService;
