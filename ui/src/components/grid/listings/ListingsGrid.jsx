/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Link } from 'react-router';
import { Button, Tooltip } from '@douyinfe/semi-ui-19';
import {
  IconBriefcase,
  IconCart,
  IconDelete,
  IconMapPin,
  IconStar,
  IconStarStroked,
  IconEyeOpened,
} from '@douyinfe/semi-icons';
import no_image from '../../../assets/no_image.png';
import { formatEuroPrice } from '../../../services/price/priceService.js';
import * as timeService from '../../../services/time/timeService.js';
import StatusControl from '../../listings/StatusControl.jsx';
import ExternalListingLink from '../../listings/ExternalListingLink.jsx';
import AffordabilityChip from '../../listings/AffordabilityChip.jsx';
import PriceChangeBadge from '../../listings/PriceChangeBadge.jsx';
import CommuteBadge from '../../transit/CommuteBadge.jsx';

import './ListingsGrid.less';
import { useTranslation, useLocale } from '../../../services/i18n/i18n.jsx';

/**
 * @param {{ listings: object[], onWatch: Function, onDelete: Function, onRestore?: Function, isHiddenView?: boolean, onStatusChange: Function }} props
 */
const ListingsGrid = ({ listings, onWatch, onDelete, onRestore, isHiddenView = false, onStatusChange }) => {
  const t = useTranslation();
  const locale = useLocale();
  return (
    <div className="listingsGrid__grid">
      {listings.map((item) => {
        // Hidden/trashed listings have no detail page to open, so `detailPath` stays
        // null and the card/eye-button below render as plain, non-navigable content.
        const detailPath = isHiddenView ? null : `/listings/listing/${item.id}`;
        const cardContent = (
          <>
            <div className="listingsGrid__card__image-wrapper">
              <img
                src={item.image_url ? `/api/listings/${item.id}/image` : no_image}
                alt={item.title}
                onError={(e) => {
                  e.target.src = no_image;
                }}
              />
              {!item.is_active && (
                <div className="listingsGrid__card__inactive-watermark">
                  <span>{t('listings.cardInactive')}</span>
                </div>
              )}
            </div>

            <div className="listingsGrid__card__body">
              <div className="listingsGrid__card__title" title={item.title}>
                {item.title}
              </div>
              {item.price && (
                <div className="listingsGrid__card__price">
                  <IconCart size="small" />
                  {formatEuroPrice(item.price, locale)}
                  <AffordabilityChip verdict={item.affordabilityVerdict} dealType={item.dealType} />
                  <PriceChangeBadge
                    price={item.price}
                    previousPrice={item.previous_price}
                    changedAt={item.price_changed_at}
                  />
                </div>
              )}
              {item.address && (
                <div className="listingsGrid__card__meta">
                  <IconMapPin />
                  {item.address}
                </div>
              )}
              <div className="listingsGrid__card__meta">
                <IconBriefcase />
                {item.provider}
              </div>
              {/* Compact on purpose: on a card the commute is a number you scan past twenty others,
                  not something you read. The detail page shows the full picture. */}
              <CommuteBadge travelTimes={item.travelTimes} jobId={item.job_id} />
              <div className="listingsGrid__card__provider">{timeService.format(item.created_at, false, locale)}</div>
            </div>
          </>
        );
        return (
          <div key={item.id} className="listingsGrid__card">
            {detailPath ? (
              // A real anchor (via react-router's Link), not an onClick+navigate() div: this is
              // what gives the card native middle-click/ctrl-click "open in new tab" and a right-click
              // context menu, matching ExternalListingLink's rationale for the portal link below.
              // `display: contents` keeps its children as direct participants in the card's flex
              // column, so wrapping them doesn't disturb the layout. The star toggle below is kept
              // as a sibling rather than nested in here, since a <button> isn't valid inside an <a>.
              <Link to={detailPath} className="listingsGrid__card__link">
                {cardContent}
              </Link>
            ) : (
              cardContent
            )}

            <Tooltip
              content={
                item.isWatched === 1 ? t('listings.tooltipRemoveFromWatchlist') : t('listings.tooltipAddToWatchlist')
              }
            >
              <button
                type="button"
                className="listingsGrid__card__star"
                onClick={(e) => onWatch(e, item)}
                aria-label={
                  item.isWatched === 1 ? t('listings.tooltipRemoveFromWatchlist') : t('listings.tooltipAddToWatchlist')
                }
              >
                {item.isWatched === 1 ? <IconStar /> : <IconStarStroked />}
              </button>
            </Tooltip>

            <div className="listingsGrid__card__actions">
              <StatusControl
                status={item.status?.status ?? null}
                compact
                onChange={(next) => onStatusChange?.(item, next)}
                onTriggerClick={(e) => e.stopPropagation()}
              />
              <ExternalListingLink href={item.link} label={t('listings.tooltipOriginalListing')} />
              {detailPath ? (
                <Link
                  to={detailPath}
                  className="listingsGrid__card__viewLink"
                  aria-label={t('listings.tooltipViewInFredy')}
                >
                  <Tooltip content={t('listings.tooltipViewInFredy')}>
                    <Button
                      size="small"
                      icon={<IconEyeOpened />}
                      style={{ color: 'var(--f-success)' }}
                      theme="borderless"
                    />
                  </Tooltip>
                </Link>
              ) : (
                <Tooltip content={t('listings.tooltipViewInFredy')}>
                  <Button
                    size="small"
                    icon={<IconEyeOpened />}
                    style={{ color: 'var(--f-success)' }}
                    theme="borderless"
                    disabled
                  />
                </Tooltip>
              )}
              {isHiddenView ? (
                <Tooltip content={t('listings.tooltipUndelete')}>
                  <Button
                    size="small"
                    icon={
                      <span className="listingsGrid__strike" aria-hidden="true">
                        <IconDelete />
                      </span>
                    }
                    style={{ color: 'var(--f-success)' }}
                    theme="borderless"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRestore?.(item.id);
                    }}
                    aria-label={t('listings.tooltipUndelete')}
                  />
                </Tooltip>
              ) : (
                <Tooltip content={t('listings.tooltipRemove')}>
                  <Button
                    size="small"
                    icon={<IconDelete />}
                    style={{ color: 'var(--f-error)' }}
                    theme="borderless"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item.id);
                    }}
                  />
                </Tooltip>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ListingsGrid;
