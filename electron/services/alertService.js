'use strict';

/**
 * alertService.js — Alert Service (nChat alerts deleted / disabled)
 */

const activeIssues = new Map();

function getAlertConfig() {
  return { senderNumber: '', receiverNumber: '', enabled: false };
}

async function dispatchAlert() {
  return { success: true, disabled: true };
}

async function raiseIssue({ issueId, component, problem } = {}) {
  // Alerts disabled - logging locally only if needed
  if (issueId) {
    activeIssues.set(issueId, { component, problem, detectedAt: Date.now() });
  }
}

async function resolveIssue({ issueId } = {}) {
  if (issueId) {
    activeIssues.delete(issueId);
  }
}

function startAlertService() {
  // No-op
}

function stopAlertService() {
  // No-op
}

async function sendTestAlert() {
  return { success: false, disabled: true, message: 'nChat alert service has been removed.' };
}

module.exports = {
  startAlertService,
  stopAlertService,
  raiseIssue,
  resolveIssue,
  dispatchAlert,
  sendTestAlert,
  getAlertConfig,
  activeIssues
};
