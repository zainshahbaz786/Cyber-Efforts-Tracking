(function (CET) {
  /**
   * Reads a value from a SharePoint item using CONFIG.fields mapping,
   * and falls back to common alternate internal names (spaces → _x0020_, etc.).
   */
  function altNames(logicalKey, primaryInternal) {
    const alts = new Set([primaryInternal]);
    if (primaryInternal.includes('_')) {
      alts.add(primaryInternal.replace(/_/g, '_x0020_'));
    }
    const titleCase = logicalKey.replace(/([A-Z])/g, ' $1').trim();
    if (titleCase) alts.add(titleCase.replace(/ /g, '_x0020_'));

    const map = {
      projectId: ['ProjectId', 'Project'],
      projectNumber: ['ProjectNumber'],
      itemId: ['ItemID', 'ItemId', 'Item_x0020_ID'],
      mmConsumed: ['MMConsumed', 'MM_x0020_Consumed'],
      noteDate: ['NoteDate', 'Note_x0020_Date'],
      plannedDate: ['PlannedDate', 'Planned_x0020_Date'],
      actualDate: ['ActualDate', 'Actual_x0020_Date'],
      nextSubmissionDate: ['NextSubmissionDate', 'Next_x0020_Submission_x0020_Date'],
      nextSubmissionType: ['NextSubmissionType', 'Next_x0020_Submission_x0020_Type'],
      latestNote: ['LatestNote', 'Latest_x0020_Note'],
      blockedSince: ['BlockedSince', 'Blocked_x0020_Since'],
      statusReason: ['StatusReason', 'Status_x0020_Reason'],
      cyberProvisioned: ['CyberProvisioned', 'Cyber_x0020_Provisioned'],
      submissionStatus: ['SubmissionStatus', 'Submission_x0020_Status'],
      budgetMM: ['BudgetMM', 'Budget_x0020_MM'],
      changedOn: ['ChangedOn', 'Changed_x0020_On'],
      changedBy: ['ChangedBy', 'Changed_x0020_By'],
      sourceList: ['SourceList', 'Source_x0020_List'],
      oldValue: ['OldValue', 'Old_x0020_Value'],
      newValue: ['NewValue', 'New_x0020_Value'],
      changeType: ['ChangeType', 'Change_x0020_Type'],
      itemLabel: ['ItemLabel', 'Item_x0020_Label'],
      dssPM: ['DSS_PM', 'DSS_x0020_PM'],
      projectPM: ['ProjectPM', 'Project_x0020_PM'],
      cyberPM: ['CyberPM', 'Cyber_x0020_PM'],
    };
    (map[logicalKey] || []).forEach((n) => alts.add(n));
    return [...alts];
  }

  function getRawField(raw, logicalKey, primaryInternal) {
    if (!raw) return undefined;
    if (raw[primaryInternal] !== undefined) return raw[primaryInternal];
    for (const name of altNames(logicalKey, primaryInternal)) {
      if (raw[name] !== undefined) return raw[name];
    }
    return undefined;
  }

  function getLookupIdFromRaw(raw, logicalKey, primaryInternal, lookupName) {
    const idKey = primaryInternal.endsWith('Id') ? primaryInternal : `${primaryInternal}Id`;
    if (raw[idKey] != null) return Number(raw[idKey]);
    for (const name of altNames(logicalKey, idKey)) {
      if (raw[name] != null) return Number(raw[name]);
    }
    const lookup = lookupName || primaryInternal;
    const val = getRawField(raw, logicalKey, lookup);
    if (val && typeof val === 'object' && val.Id != null) return Number(val.Id);
    return null;
  }

  CET.fieldResolver = { getRawField, getLookupIdFromRaw, altNames };
})(window.CyberEffortsTracker);
