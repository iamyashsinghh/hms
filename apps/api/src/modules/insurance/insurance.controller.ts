import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { insurance as contracts, type Paginated } from '@hms/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodPipe } from '../../common/validation/zod.pipe';
import { InsuranceService } from './insurance.service';

const uuid = new ParseUUIDPipe();
const packagesQuery = z.object({ all: z.enum(['true', 'false']).default('false') });

@Controller('insurance')
export class InsuranceController {
  constructor(private readonly insurance: InsuranceService) {}

  // ---------- payers and packages ----------

  @Get('payers')
  @RequirePermissions('insurance.payer.read')
  listPayers(@Query() query: unknown): Promise<Paginated<contracts.Payer>> {
    return this.insurance.listPayers(query);
  }

  @Get('payers/:id')
  @RequirePermissions('insurance.payer.read')
  getPayer(@Param('id', uuid) id: string): Promise<contracts.Payer> {
    return this.insurance.getPayer(id);
  }

  @Post('payers')
  @RequirePermissions('insurance.payer.manage')
  createPayer(@Body(new ZodPipe(contracts.payerInputSchema)) body: contracts.PayerInput): Promise<contracts.Payer> {
    return this.insurance.createPayer(body);
  }

  @Patch('payers/:id')
  @RequirePermissions('insurance.payer.manage')
  updatePayer(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updatePayerSchema)) body: contracts.UpdatePayer): Promise<contracts.Payer> {
    return this.insurance.updatePayer(id, body);
  }

  @Get('payers/:id/packages')
  @RequirePermissions('insurance.payer.read')
  listPackages(@Param('id', uuid) id: string, @Query(new ZodPipe(packagesQuery)) q: z.infer<typeof packagesQuery>): Promise<contracts.SchemePackage[]> {
    return this.insurance.listPackages(id, q.all === 'true');
  }

  @Post('payers/:id/packages')
  @RequirePermissions('insurance.payer.manage')
  createPackage(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.packageInputSchema)) body: contracts.PackageInput): Promise<contracts.SchemePackage> {
    return this.insurance.createPackage(id, body);
  }

  @Patch('payers/:id/packages/:packageId')
  @RequirePermissions('insurance.payer.manage')
  updatePackage(
    @Param('id', uuid) id: string,
    @Param('packageId', uuid) packageId: string,
    @Body(new ZodPipe(contracts.updatePackageSchema)) body: contracts.UpdatePackage,
  ): Promise<contracts.SchemePackage> {
    return this.insurance.updatePackage(id, packageId, body);
  }

  // ---------- policies ----------

  @Get('policies')
  @RequirePermissions('insurance.policy.read')
  listPolicies(@Query() query: unknown): Promise<Paginated<contracts.Policy>> {
    return this.insurance.listPolicies(query);
  }

  @Get('policies/:id')
  @RequirePermissions('insurance.policy.read')
  getPolicy(@Param('id', uuid) id: string): Promise<contracts.Policy> {
    return this.insurance.getPolicy(id);
  }

  @Post('policies')
  @RequirePermissions('insurance.policy.manage')
  createPolicy(@Body(new ZodPipe(contracts.policyInputSchema)) body: contracts.PolicyInput): Promise<contracts.Policy> {
    return this.insurance.createPolicy(body);
  }

  @Patch('policies/:id')
  @RequirePermissions('insurance.policy.manage')
  updatePolicy(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updatePolicySchema)) body: contracts.UpdatePolicy): Promise<contracts.Policy> {
    return this.insurance.updatePolicy(id, body);
  }

  @Post('policies/:id/verify')
  @HttpCode(200)
  @RequirePermissions('insurance.policy.manage')
  verifyPolicy(@Param('id', uuid) id: string): Promise<contracts.EligibilityResult> {
    return this.insurance.verifyPolicy(id);
  }

  // ---------- pre-authorisation ----------

  @Get('preauths')
  @RequirePermissions('insurance.preauth.read')
  listPreauths(@Query() query: unknown): Promise<Paginated<contracts.PreauthSummary>> {
    return this.insurance.listPreauths(query);
  }

  @Get('preauths/:id')
  @RequirePermissions('insurance.preauth.read')
  getPreauth(@Param('id', uuid) id: string): Promise<contracts.Preauth> {
    return this.insurance.getPreauth(id);
  }

  @Post('preauths')
  @RequirePermissions('insurance.preauth.manage')
  createPreauth(@Body(new ZodPipe(contracts.preauthInputSchema)) body: contracts.PreauthInput): Promise<contracts.Preauth> {
    return this.insurance.createPreauth(body);
  }

  @Patch('preauths/:id')
  @RequirePermissions('insurance.preauth.manage')
  updatePreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updatePreauthSchema)) body: contracts.UpdatePreauth): Promise<contracts.Preauth> {
    return this.insurance.updatePreauth(id, body);
  }

  @Post('preauths/:id/submit')
  @HttpCode(200)
  @RequirePermissions('insurance.preauth.manage')
  submitPreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.submitSchema)) body: contracts.SubmitInput): Promise<contracts.Preauth> {
    return this.insurance.submitPreauth(id, body ?? {});
  }

  @Post('preauths/:id/query')
  @HttpCode(200)
  @RequirePermissions('insurance.preauth.manage')
  queryPreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.reasonSchema)) body: contracts.ReasonInput): Promise<contracts.Preauth> {
    return this.insurance.queryPreauth(id, body);
  }

  @Post('preauths/:id/approve')
  @HttpCode(200)
  @RequirePermissions('insurance.preauth.manage')
  approvePreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.preauthApproveSchema)) body: contracts.PreauthApprove): Promise<contracts.Preauth> {
    return this.insurance.approvePreauth(id, body);
  }

  @Post('preauths/:id/reject')
  @HttpCode(200)
  @RequirePermissions('insurance.preauth.manage')
  rejectPreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.reasonSchema)) body: contracts.ReasonInput): Promise<contracts.Preauth> {
    return this.insurance.rejectPreauth(id, body);
  }

  @Post('preauths/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('insurance.preauth.manage')
  cancelPreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.reasonSchema)) body: contracts.ReasonInput): Promise<contracts.Preauth> {
    return this.insurance.cancelPreauth(id, body);
  }

  @Post('preauths/:id/enhance')
  @HttpCode(200)
  @RequirePermissions('insurance.preauth.manage')
  enhancePreauth(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.preauthEnhanceSchema)) body: contracts.PreauthEnhance): Promise<contracts.Preauth> {
    return this.insurance.enhancePreauth(id, body);
  }

  // ---------- claims ----------

  @Get('claims')
  @RequirePermissions('insurance.claim.read')
  listClaims(@Query() query: unknown): Promise<Paginated<contracts.ClaimSummary>> {
    return this.insurance.listClaims(query);
  }

  @Get('claims/:id')
  @RequirePermissions('insurance.claim.read')
  getClaim(@Param('id', uuid) id: string): Promise<contracts.Claim> {
    return this.insurance.getClaim(id);
  }

  @Post('claims')
  @RequirePermissions('insurance.claim.manage')
  createClaim(@Body(new ZodPipe(contracts.claimInputSchema)) body: contracts.ClaimInput): Promise<contracts.Claim> {
    return this.insurance.createClaim(body);
  }

  @Patch('claims/:id')
  @RequirePermissions('insurance.claim.manage')
  updateClaim(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.updateClaimSchema)) body: contracts.UpdateClaim): Promise<contracts.Claim> {
    return this.insurance.updateClaim(id, body);
  }

  @Post('claims/:id/submit')
  @HttpCode(200)
  @RequirePermissions('insurance.claim.manage')
  submitClaim(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.submitSchema)) body: contracts.SubmitInput): Promise<contracts.Claim> {
    return this.insurance.submitClaim(id, body ?? {});
  }

  @Post('claims/:id/query')
  @HttpCode(200)
  @RequirePermissions('insurance.claim.manage')
  queryClaim(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.reasonSchema)) body: contracts.ReasonInput): Promise<contracts.Claim> {
    return this.insurance.queryClaim(id, body);
  }

  @Post('claims/:id/approve')
  @HttpCode(200)
  @RequirePermissions('insurance.claim.manage')
  approveClaim(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.claimApproveSchema)) body: contracts.ClaimApprove): Promise<contracts.Claim> {
    return this.insurance.approveClaim(id, body);
  }

  @Post('claims/:id/reject')
  @HttpCode(200)
  @RequirePermissions('insurance.claim.manage')
  rejectClaim(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.reasonSchema)) body: contracts.ReasonInput): Promise<contracts.Claim> {
    return this.insurance.rejectClaim(id, body);
  }

  @Post('claims/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('insurance.claim.manage')
  cancelClaim(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.reasonSchema)) body: contracts.ReasonInput): Promise<contracts.Claim> {
    return this.insurance.cancelClaim(id, body);
  }

  @Post('claims/:id/documents')
  @RequirePermissions('insurance.claim.manage')
  addDocument(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.documentInputSchema)) body: contracts.DocumentInput): Promise<contracts.Claim> {
    return this.insurance.addDocument(id, body);
  }

  @Patch('claims/:id/documents/:docId')
  @RequirePermissions('insurance.claim.manage')
  updateDocument(
    @Param('id', uuid) id: string,
    @Param('docId', uuid) docId: string,
    @Body(new ZodPipe(contracts.updateDocumentSchema)) body: contracts.UpdateDocument,
  ): Promise<contracts.Claim> {
    return this.insurance.updateDocument(id, docId, body);
  }

  @Delete('claims/:id/documents/:docId')
  @RequirePermissions('insurance.claim.manage')
  removeDocument(@Param('id', uuid) id: string, @Param('docId', uuid) docId: string): Promise<contracts.Claim> {
    return this.insurance.removeDocument(id, docId);
  }

  @Post('claims/:id/settlements')
  @RequirePermissions('insurance.settlement.record')
  recordSettlement(@Param('id', uuid) id: string, @Body(new ZodPipe(contracts.settlementInputSchema)) body: contracts.SettlementInput): Promise<contracts.Claim> {
    return this.insurance.recordSettlement(id, body);
  }

  @Post('settlements/:id/post')
  @HttpCode(200)
  @RequirePermissions('insurance.settlement.record')
  retryPosting(@Param('id', uuid) id: string): Promise<contracts.Claim> {
    return this.insurance.retryPosting(id);
  }

  // ---------- payer split and reports ----------

  @Get('invoices/:id/split')
  @RequirePermissions('insurance.claim.read')
  split(@Param('id', uuid) id: string): Promise<contracts.InvoiceSplit> {
    return this.insurance.getInvoiceSplit(id);
  }

  @Get('summary')
  @RequirePermissions('insurance.report.read')
  summary(): Promise<contracts.InsuranceSummary> {
    return this.insurance.summary();
  }
}
