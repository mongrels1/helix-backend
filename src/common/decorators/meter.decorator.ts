import { SetMetadata } from '@nestjs/common';
import type { UsageKind } from '../usage/usage.constants';

export const METER_KEY = 'meteredUsageKind';

/**
 * Marks a handler as costing one unit of the free daily allowance.
 *
 * Put it only on the endpoint that delivers the value - the tutor reply, the
 * practice answer - never on a read. The whole model is unlimited *access* with
 * limited *quantity*: a student must always be able to open the page, see their
 * history and load an item. Only doing the thing counts.
 */
export const Meter = (kind: UsageKind) => SetMetadata(METER_KEY, kind);
