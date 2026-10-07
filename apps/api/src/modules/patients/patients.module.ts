import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsRepository } from './patients.repository';
import { PatientsService } from './patients.service';

/** Patient master. Other modules import PatientsModule and use PatientsService instead of querying clinical.patients. */
@Module({ controllers: [PatientsController], providers: [PatientsService, PatientsRepository], exports: [PatientsService] })
export class PatientsModule {}
