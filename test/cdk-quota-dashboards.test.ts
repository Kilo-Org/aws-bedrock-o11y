import { BEDROCK_MODELS, getQuotaCodes, validateModelEndpointSupport, getSupportedEndpointTypes } from '../lib/bedrock-registries';

describe('Registry Helper Functions', () => {
    describe('getQuotaCodes', () => {
        test('should return quota codes for supported endpoint type', () => {
            // Test with a known model and supported endpoint
            const result = getQuotaCodes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'cross-region');
            expect(result).not.toBeNull();
            expect(result?.tokenQuotaCode).toMatch(/^L-[A-Z0-9]{8}$/);
            expect(result?.requestQuotaCode).toMatch(/^L-[A-Z0-9]{8}$/);
        });

        test('should return null for unsupported endpoint type', () => {
            const result = getQuotaCodes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'regional');
            expect(result).toBeNull();
        });
    });

    describe('validateModelEndpointSupport', () => {
        test('should return true for supported model and endpoint type', () => {
            const result = validateModelEndpointSupport(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'cross-region');
            expect(result).toBe(true);
        });

        test('should return false for unsupported endpoint type', () => {
            const result = validateModelEndpointSupport(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'regional');
            expect(result).toBe(false);
        });
    });

    describe('getSupportedEndpointTypes', () => {
        test('should return supported endpoint types for models', () => {
            const result = getSupportedEndpointTypes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1);
            expect(result).toEqual(['cross-region']);
            expect(result.length).toBeGreaterThan(0);
        });

        test('should return valid endpoint types', () => {
            const validEndpoints = ['regional', 'cross-region', 'global-cross-region'];
            const result = getSupportedEndpointTypes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1);
            result.forEach(endpoint => {
                expect(validEndpoints).toContain(endpoint);
            });
        });
    });

    describe('Model Configuration Properties', () => {
        test('should have correct model ID format', () => {
            expect(BEDROCK_MODELS.AMAZON.NOVA_LITE_V1.modelId).toBe('amazon.nova-lite-v1:0');
            expect(BEDROCK_MODELS.AMAZON.NOVA_LITE_V1.modelId).toMatch(/^amazon\./);
        });

        test('should have valid burndown rates', () => {
            expect(BEDROCK_MODELS.AMAZON.NOVA_LITE_V1.outputTokenBurndownRate).toBe(1);
            expect([1, 5]).toContain(BEDROCK_MODELS.AMAZON.NOVA_LITE_V1.outputTokenBurndownRate);
        });

        test('should have valid supported endpoints', () => {
            const validEndpoints = ['regional', 'cross-region', 'global-cross-region'];
            BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1.supportedEndpoints.forEach(endpoint => {
                expect(validEndpoints).toContain(endpoint);
            });
        });

        test('should have quota codes in correct format for supported endpoints', () => {
            const quotaCodePattern = /^L-[A-Z0-9]{8}$/;
            
            // Test cross-region endpoint (supported by NOVA_PREMIER_V1)
            const crossRegionCodes = BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1.crossRegion;
            expect(crossRegionCodes?.tokenQuotaCode).toMatch(quotaCodePattern);
            expect(crossRegionCodes?.requestQuotaCode).toMatch(quotaCodePattern);
        });

        test('should not have quota codes for unsupported endpoints', () => {
            expect(getQuotaCodes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'regional')).toBeNull();
        });
    });

    describe('Type Safety', () => {
        test('should prevent access to unsupported endpoint properties', () => {
            expect(getQuotaCodes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'regional')).toBeNull();
            expect(validateModelEndpointSupport(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'regional')).toBe(false);
            expect(getSupportedEndpointTypes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1)).not.toContain('regional');
        });

        test('should provide access to supported endpoint properties', () => {
            // Test with a model that has cross-region support
            expect(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1.crossRegion).toBeDefined();
            expect(getQuotaCodes(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'cross-region')).toBeDefined();
            expect(validateModelEndpointSupport(BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1, 'cross-region')).toBe(true);
        });
    });

    describe('Registry Structure', () => {
        test('should have Amazon models', () => {
            expect(BEDROCK_MODELS.AMAZON).toBeDefined();
            expect(Object.keys(BEDROCK_MODELS.AMAZON).length).toBeGreaterThan(0);
        });

        test('should have Anthropic models', () => {
            expect(BEDROCK_MODELS.ANTHROPIC).toBeDefined();
            expect(Object.keys(BEDROCK_MODELS.ANTHROPIC).length).toBeGreaterThan(0);
        });

        test('should have consistent model structure', () => {
            // Test a few specific models to ensure structure consistency
            const testModels = [
                BEDROCK_MODELS.AMAZON.NOVA_LITE_V1,
                BEDROCK_MODELS.AMAZON.NOVA_PREMIER_V1,
                BEDROCK_MODELS.ANTHROPIC.CLAUDE_3_HAIKU
            ];

            testModels.forEach(model => {
                expect(model.modelId).toBeDefined();
                expect(typeof model.modelId).toBe('string');
                expect(model.outputTokenBurndownRate).toBeDefined();
                expect(typeof model.outputTokenBurndownRate).toBe('number');
                expect(model.supportedEndpoints).toBeDefined();
                expect(Array.isArray(model.supportedEndpoints)).toBe(true);
                expect(model.supportedEndpoints.length).toBeGreaterThan(0);
            });
        });
    });
});
