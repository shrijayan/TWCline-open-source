# TWCline Extension Development Plan

## Completed Task: Extension Renaming
- ✅ Command mismatch fix between package.json declarations (twcline.*) and source code registrations (cline.*)
- ✅ All command registrations updated to use twcline.* prefix
- ✅ WebView provider IDs updated
- ✅ Implementation complete and ready for testing

## Current Task: Move Statistics to Settings Page

### Problem
- Statistics button was previously in accounts page but is not showing
- Token usage statistics are currently showing in settings page
- Need to consolidate all statistics in one place (settings page)

### Implementation Plan

#### 1. Modify SettingsView.tsx
- [x] Add state to toggle between settings and statistics view (`showStatistics`)
- [x] Add "Statistics" button in settings page with graph icon
- [x] Implement conditional rendering to show either settings or statistics
- [x] Add back navigation from statistics to settings

#### 2. Update Statistics Components
- [x] Import StatisticsView from account components
- [x] Ensure comprehensive statistics are available:
  - Token Usage & Cost (via TokenUsageSection)
  - File Edit Suggestions (acceptance rate, total suggestions)
  - Prompt Quality (average quality score)
  - Code Commit Stats (lines written, commit ratio)

#### 3. Clean Up Accounts Page
- [x] Remove Statistics button from AccountView.tsx
- [x] Remove unused statistics-related state and functions
- [x] Clean up imports and function parameters

#### 4. Test Integration
- [ ] Verify statistics button appears in settings
- [ ] Test navigation between settings and statistics
- [ ] Confirm all statistics data displays correctly

### User Flow
Settings Page → [Statistics Button] → Comprehensive Stats View → [Back Button] → Settings Page

## Status
✅ Implementation Complete - Ready for Testing

### Summary of Changes
- **SettingsView.tsx**: Added statistics button and comprehensive statistics integration
- **AccountView.tsx**: Removed statistics functionality, focused on account management
- **User Experience**: Statistics now accessible from settings page with full functionality
- **Components**: Reused existing StatisticsView component for consistency
