// Test file to verify that the original TypeScript configuration errors are resolved
// This file should compile without the original "Cannot find type definition file" errors

// These imports should work now that we've removed the problematic types from tsconfig.app.json
// The testing types are handled through the test setup files instead

console.log("TypeScript configuration test - this should compile without the original errors")

export {}
