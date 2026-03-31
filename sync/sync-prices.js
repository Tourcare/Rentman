const db = require('../lib/database');
const hubspot = require('../lib/hubspot-client');
const { createChildLogger } = require('../lib/logger');
const { sanitizeNumber, sleep } = require('../lib/utils');

const logger = createChildLogger('sync-prices');

// HubSpot product IDs for each price category
const PRODUCT_MAP = {
    'Salg med moms':    '412309550328',
    'Salg uden moms':   '412310271169',
    'Ydelse med moms':  '412216270038',
    'Ydelse uden moms': '412219929846',
    'Insurance':        '394858376380'
};

// Maps SQL columns to line item names
function buildLineItems(row) {
    return [
        { name: 'Salg med moms',    price: sanitizeNumber(row.equipment_vat) },
        { name: 'Salg uden moms',   price: sanitizeNumber(row.equipment_no_vat) },
        { name: 'Ydelse med moms',  price: sanitizeNumber(row.functions_vat) },
        { name: 'Ydelse uden moms', price: sanitizeNumber(row.functions_no_vat) },
        { name: 'Insurance',        price: sanitizeNumber(row.insurance) }
    ].filter(item => item.price > 0);
}

// ============================================================================
// SQL: Project-level prices (aggregated from subprojects) — for deals
// ============================================================================
const PROJECT_PRICES_SQL = `
SELECT
    project_id,
    project_name,
    project_number,
    COUNT(*)                                                        AS subproject_count,

    ROUND(SUM(equipment_no_vat), 2)                                AS equipment_no_vat,
    ROUND(SUM(equipment_vat), 2)                                   AS equipment_vat,
    ROUND(SUM(functions_no_vat), 2)                                AS functions_no_vat,
    ROUND(SUM(functions_vat), 2)                                   AS functions_vat,
    ROUND(SUM(insurance), 2)                                       AS insurance

FROM (

    SELECT
        p.id                                            AS project_id,
        p.name                                          AS project_name,
        p.number                                        AS project_number,

        IFNULL(eq_no_vat.total, 0)                      AS equipment_no_vat,
        IFNULL(eq_vat.total, 0)                         AS equipment_vat,
        IFNULL(fn_no_vat.total, 0)                      AS functions_no_vat,
        IFNULL(fn_vat.total, 0)                         AS functions_vat,
        IFNULL(ins.total, 0)                            AS insurance

    FROM projects p
    JOIN subprojects s
        ON CAST(SUBSTRING_INDEX(s.project, '/', -1) AS UNSIGNED) = p.id

    LEFT JOIN (
        SELECT subproject_id, SUM(line_total * discount_factor * subproject_factor) AS total
        FROM (
            SELECT
                CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                ((e.unit_price * e.quantity_total) * e.factor) * (1 - IFNULL(e.discount, 0)) AS line_total,
                CASE
                    WHEN e.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN e.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                END AS discount_factor,
                (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
            FROM project_equipment e
            JOIN project_equipment_group g ON CAST(SUBSTRING_INDEX(e.equipment_group, '/', -1) AS UNSIGNED) = g.id
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE (e.ledger = '/ledgercodes/14' OR e.ledger = '/ledgercodes/15')
              AND g.in_price_calculation = 1 AND s2.status != '/statuses/2'
            UNION ALL
            SELECT
                CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                ((c.unit_price * c.quantity) * IFNULL(c.factor, 1)) * (1 - IFNULL(c.discount, 0)) AS line_total,
                CASE
                    WHEN c.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN c.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                END AS discount_factor,
                (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
            FROM project_costs c
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE (c.ledger = '/ledgercodes/14' OR c.ledger = '/ledgercodes/15')
              AND s2.status != '/statuses/2'
        ) AS combined_no_vat
        GROUP BY subproject_id
    ) AS eq_no_vat ON eq_no_vat.subproject_id = s.id

    LEFT JOIN (
        SELECT subproject_id, SUM(line_total * discount_factor * subproject_factor) AS total
        FROM (
            SELECT
                CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                ((e.unit_price * e.quantity_total) * e.factor) * (1 - IFNULL(e.discount, 0)) AS line_total,
                CASE
                    WHEN e.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                    WHEN e.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                    WHEN e.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN e.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                    ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
                END AS discount_factor,
                (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
            FROM project_equipment e
            JOIN project_equipment_group g ON CAST(SUBSTRING_INDEX(e.equipment_group, '/', -1) AS UNSIGNED) = g.id
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE e.ledger NOT IN (
                '/ledgercodes/14', '/ledgercodes/15',
                '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
                '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
            )
              AND g.in_price_calculation = 1 AND s2.status != '/statuses/2'
            UNION ALL
            SELECT
                CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                ((c.unit_price * c.quantity) * IFNULL(c.factor, 1)) * (1 - IFNULL(c.discount, 0)) AS line_total,
                CASE
                    WHEN c.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                    WHEN c.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                    WHEN c.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN c.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                    ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
                END AS discount_factor,
                (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
            FROM project_costs c
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE c.ledger NOT IN (
                '/ledgercodes/14', '/ledgercodes/15',
                '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
                '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
            )
              AND s2.status != '/statuses/2'
        ) AS combined_vat
        GROUP BY subproject_id
    ) AS eq_vat ON eq_vat.subproject_id = s.id

    LEFT JOIN (
        SELECT
            CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            SUM(
                COALESCE(f.price_total, f.unit_price * f.quantity * (1 - IFNULL(f.discount, 0))) *
                CASE
                    WHEN f.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN f.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                END *
                (1 - IFNULL(s2.discount_subproject, 0))
            ) AS total
        FROM project_functions f
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE (f.ledger = '/ledgercodes/14' OR f.ledger = '/ledgercodes/15')
          AND IFNULL(f.in_financial, 1) = 1 AND s2.status != '/statuses/2'
        GROUP BY subproject_id
    ) AS fn_no_vat ON fn_no_vat.subproject_id = s.id

    LEFT JOIN (
        SELECT
            CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            SUM(
                COALESCE(f.price_total, f.unit_price * f.quantity * (1 - IFNULL(f.discount, 0))) *
                CASE
                    WHEN f.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                    WHEN f.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                    WHEN f.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN f.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                    ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
                END *
                (1 - IFNULL(s2.discount_subproject, 0))
            ) AS total
        FROM project_functions f
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE f.ledger NOT IN (
            '/ledgercodes/14', '/ledgercodes/15',
            '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
            '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
        )
          AND IFNULL(f.in_financial, 1) = 1 AND s2.status != '/statuses/2'
        GROUP BY subproject_id
    ) AS fn_vat ON fn_vat.subproject_id = s.id

    LEFT JOIN (
        SELECT subproject_id, SUM(line_total * discount_factor) * MAX(insurance_rate) AS total
        FROM (
            SELECT
                CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                ((e.unit_price * e.quantity_total) * e.factor) * (1 - IFNULL(e.discount, 0)) AS line_total,
                CASE
                    WHEN e.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                    WHEN e.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                    WHEN e.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN e.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                    WHEN e.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN e.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                    ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
                END AS discount_factor,
                s2.insurance_rate
            FROM project_equipment e
            JOIN project_equipment_group g ON CAST(SUBSTRING_INDEX(e.equipment_group, '/', -1) AS UNSIGNED) = g.id
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE e.ledger NOT IN (
                '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
                '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
            )
              AND g.in_price_calculation = 1 AND s2.status != '/statuses/2'
            UNION ALL
            SELECT
                CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                ((c.unit_price * c.quantity) * IFNULL(c.factor, 1)) * (1 - IFNULL(c.discount, 0)) AS line_total,
                CASE
                    WHEN c.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                    WHEN c.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                    WHEN c.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN c.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                    WHEN c.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN c.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                    ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
                END AS discount_factor,
                s2.insurance_rate
            FROM project_costs c
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE c.ledger NOT IN (
                '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
                '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
            )
              AND s2.status != '/statuses/2'
            UNION ALL
            SELECT
                CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
                COALESCE(f.price_total, f.unit_price * f.quantity * (1 - IFNULL(f.discount, 0))) AS line_total,
                CASE
                    WHEN f.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                    WHEN f.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                    WHEN f.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN f.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                    WHEN f.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                    WHEN f.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                    ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
                END AS discount_factor,
                s2.insurance_rate
            FROM project_functions f
            JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) = s2.id
            WHERE f.ledger NOT IN (
                '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
                '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
            )
              AND IFNULL(f.in_financial, 1) = 1 AND s2.status != '/statuses/2'
        ) AS ins_base
        GROUP BY subproject_id
    ) AS ins ON ins.subproject_id = s.id

    WHERE s.status != '/statuses/2'

) AS sp

GROUP BY project_id, project_name, project_number
ORDER BY project_id DESC
LIMIT 10
`;

// ============================================================================
// SQL: Subproject-level prices — for orders
// ============================================================================
const SUBPROJECT_PRICES_SQL = `
SELECT
    p.id                                            AS project_id,
    p.name                                          AS project_name,
    p.number                                        AS project_number,
    s.id                                            AS subproject_id,
    s.name                                          AS subproject_name,

    ROUND(IFNULL(eq_no_vat.total, 0), 2)            AS equipment_no_vat,
    ROUND(IFNULL(eq_vat.total, 0), 2)               AS equipment_vat,
    ROUND(IFNULL(fn_no_vat.total, 0), 2)            AS functions_no_vat,
    ROUND(IFNULL(fn_vat.total, 0), 2)               AS functions_vat,
    ROUND(IFNULL(ins.total, 0), 2)                  AS insurance

FROM projects p
JOIN subprojects s
    ON CAST(SUBSTRING_INDEX(s.project, '/', -1) AS UNSIGNED) = p.id

LEFT JOIN (
    SELECT subproject_id, SUM(line_total * discount_factor * subproject_factor) AS total
    FROM (
        SELECT
            CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            ((e.unit_price * e.quantity_total) * e.factor) * (1 - IFNULL(e.discount, 0)) AS line_total,
            CASE
                WHEN e.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN e.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
            END AS discount_factor,
            (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
        FROM project_equipment e
        JOIN project_equipment_group g ON CAST(SUBSTRING_INDEX(e.equipment_group, '/', -1) AS UNSIGNED) = g.id
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE (e.ledger = '/ledgercodes/14' OR e.ledger = '/ledgercodes/15')
          AND g.in_price_calculation = 1 AND s2.status != '/statuses/2'
        UNION ALL
        SELECT
            CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            ((c.unit_price * c.quantity) * IFNULL(c.factor, 1)) * (1 - IFNULL(c.discount, 0)) AS line_total,
            CASE
                WHEN c.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN c.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
            END AS discount_factor,
            (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
        FROM project_costs c
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE (c.ledger = '/ledgercodes/14' OR c.ledger = '/ledgercodes/15')
          AND s2.status != '/statuses/2'
    ) AS combined_no_vat
    GROUP BY subproject_id
) AS eq_no_vat ON eq_no_vat.subproject_id = s.id

LEFT JOIN (
    SELECT subproject_id, SUM(line_total * discount_factor * subproject_factor) AS total
    FROM (
        SELECT
            CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            ((e.unit_price * e.quantity_total) * e.factor) * (1 - IFNULL(e.discount, 0)) AS line_total,
            CASE
                WHEN e.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                WHEN e.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                WHEN e.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN e.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
            END AS discount_factor,
            (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
        FROM project_equipment e
        JOIN project_equipment_group g ON CAST(SUBSTRING_INDEX(e.equipment_group, '/', -1) AS UNSIGNED) = g.id
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE e.ledger NOT IN (
            '/ledgercodes/14', '/ledgercodes/15',
            '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
            '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
        )
          AND g.in_price_calculation = 1 AND s2.status != '/statuses/2'
        UNION ALL
        SELECT
            CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            ((c.unit_price * c.quantity) * IFNULL(c.factor, 1)) * (1 - IFNULL(c.discount, 0)) AS line_total,
            CASE
                WHEN c.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                WHEN c.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                WHEN c.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN c.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
            END AS discount_factor,
            (1 - IFNULL(s2.discount_subproject, 0)) AS subproject_factor
        FROM project_costs c
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE c.ledger NOT IN (
            '/ledgercodes/14', '/ledgercodes/15',
            '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
            '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
        )
          AND s2.status != '/statuses/2'
    ) AS combined_vat
    GROUP BY subproject_id
) AS eq_vat ON eq_vat.subproject_id = s.id

LEFT JOIN (
    SELECT
        CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
        SUM(
            COALESCE(f.price_total, f.unit_price * f.quantity * (1 - IFNULL(f.discount, 0))) *
            CASE
                WHEN f.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN f.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
            END *
            (1 - IFNULL(s2.discount_subproject, 0))
        ) AS total
    FROM project_functions f
    JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) = s2.id
    WHERE (f.ledger = '/ledgercodes/14' OR f.ledger = '/ledgercodes/15')
      AND IFNULL(f.in_financial, 1) = 1 AND s2.status != '/statuses/2'
    GROUP BY subproject_id
) AS fn_no_vat ON fn_no_vat.subproject_id = s.id

LEFT JOIN (
    SELECT
        CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
        SUM(
            COALESCE(f.price_total, f.unit_price * f.quantity * (1 - IFNULL(f.discount, 0))) *
            CASE
                WHEN f.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                WHEN f.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                WHEN f.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN f.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
            END *
            (1 - IFNULL(s2.discount_subproject, 0))
        ) AS total
    FROM project_functions f
    JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) = s2.id
    WHERE f.ledger NOT IN (
        '/ledgercodes/14', '/ledgercodes/15',
        '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
        '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
    )
      AND IFNULL(f.in_financial, 1) = 1 AND s2.status != '/statuses/2'
    GROUP BY subproject_id
) AS fn_vat ON fn_vat.subproject_id = s.id

LEFT JOIN (
    SELECT subproject_id, SUM(line_total * discount_factor) * MAX(insurance_rate) AS total
    FROM (
        SELECT
            CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            ((e.unit_price * e.quantity_total) * e.factor) * (1 - IFNULL(e.discount, 0)) AS line_total,
            CASE
                WHEN e.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                WHEN e.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                WHEN e.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN e.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                WHEN e.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN e.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
            END AS discount_factor,
            s2.insurance_rate
        FROM project_equipment e
        JOIN project_equipment_group g ON CAST(SUBSTRING_INDEX(e.equipment_group, '/', -1) AS UNSIGNED) = g.id
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(g.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE e.ledger NOT IN (
            '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
            '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
        )
          AND g.in_price_calculation = 1 AND s2.status != '/statuses/2'
        UNION ALL
        SELECT
            CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            ((c.unit_price * c.quantity) * IFNULL(c.factor, 1)) * (1 - IFNULL(c.discount, 0)) AS line_total,
            CASE
                WHEN c.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                WHEN c.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                WHEN c.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN c.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                WHEN c.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN c.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
            END AS discount_factor,
            s2.insurance_rate
        FROM project_costs c
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(c.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE c.ledger NOT IN (
            '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
            '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
        )
          AND s2.status != '/statuses/2'
        UNION ALL
        SELECT
            CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) AS subproject_id,
            COALESCE(f.price_total, f.unit_price * f.quantity * (1 - IFNULL(f.discount, 0))) AS line_total,
            CASE
                WHEN f.ledger = '/ledgercodes/1'  THEN (1 - IFNULL(s2.discount_rental, 0))
                WHEN f.ledger = '/ledgercodes/2'  THEN (1 - IFNULL(s2.discount_sale, 0))
                WHEN f.ledger = '/ledgercodes/3'  THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN f.ledger = '/ledgercodes/4'  THEN (1 - IFNULL(s2.discount_transport, 0))
                WHEN f.ledger = '/ledgercodes/14' THEN (1 - IFNULL(s2.discount_crew, 0))
                WHEN f.ledger = '/ledgercodes/15' THEN (1 - IFNULL(s2.discount_rental, 0))
                ELSE                                   (1 - IFNULL(s2.discount_additional_costs, 0))
            END AS discount_factor,
            s2.insurance_rate
        FROM project_functions f
        JOIN subprojects s2 ON CAST(SUBSTRING_INDEX(f.subproject, '/', -1) AS UNSIGNED) = s2.id
        WHERE f.ledger NOT IN (
            '/ledgercodes/16', '/ledgercodes/17', '/ledgercodes/18',
            '/ledgercodes/19', '/ledgercodes/20', '/ledgercodes/21'
        )
          AND IFNULL(f.in_financial, 1) = 1 AND s2.status != '/statuses/2'
    ) AS ins_base
    GROUP BY subproject_id
) AS ins ON ins.subproject_id = s.id

WHERE s.status != '/statuses/2'
  AND p.id IN (?)

ORDER BY p.id, s.id
`;

// ============================================================================
// Main sync function
// ============================================================================

async function syncPrices() {
    console.log('=== Sync Prices: Start ===');
    console.log('Henter priser for de 50 seneste projekter...\n');

    // 1. Get project-level prices (50 most recent)
    const projectPrices = await db.query(PROJECT_PRICES_SQL);
    console.log(`Fundet ${projectPrices.length} projekter med prisdata\n`);

    if (projectPrices.length === 0) {
        console.log('Ingen projekter fundet. Afslutter.');
        process.exit(0);
    }

    const projectIds = projectPrices.map(r => r.project_id);

    // 2. Get subproject-level prices for those projects
    const subprojectPrices = await db.query(SUBPROJECT_PRICES_SQL, [projectIds]);
    console.log(`Fundet ${subprojectPrices.length} subprojekter med prisdata\n`);

    // 3. Get synced deals and orders to find HubSpot IDs
    const syncedDeals = await db.query('SELECT * FROM synced_deals WHERE rentman_project_id IN (?)', [projectIds]);
    const syncedOrders = await db.query(
        `SELECT o.* FROM synced_order o
         INNER JOIN synced_deals d ON o.synced_deals_id = d.id
         WHERE d.rentman_project_id IN (?)`,
        [projectIds]
    );

    // Build lookup maps
    const dealByProjectId = {};
    for (const deal of syncedDeals) {
        dealByProjectId[deal.rentman_project_id] = deal;
    }

    const orderBySubprojectId = {};
    for (const order of syncedOrders) {
        orderBySubprojectId[order.rentman_subproject_id] = order;
    }

    let dealLineItemsCreated = 0;
    let orderLineItemsCreated = 0;
    let dealsSkipped = 0;
    let ordersSkipped = 0;

    // 4. Create line items on deals (project level)
    console.log('--- Opretter line items på deals (projekt-niveau) ---\n');

    for (const project of projectPrices) {
        const deal = dealByProjectId[project.project_id];
        if (!deal) {
            dealsSkipped++;
            console.log(`  SKIP projekt ${project.project_id} (${project.project_name}) - ingen synced deal`);
            continue;
        }

        const hubspotDealId = deal.hubspot_project_id;
        const items = buildLineItems(project);

        if (items.length === 0) {
            console.log(`  SKIP deal ${hubspotDealId} (${project.project_name}) - ingen priser > 0`);
            continue;
        }

        console.log(`  Deal ${hubspotDealId} | ${project.project_name}:`);

        for (const item of items) {
            const existing = await db.findPriceLineItem(hubspotDealId, item.name, 'deal');

            if (existing) {
                try {
                    await hubspot.updateLineItem(existing.hubspot_line_item_id, { price: String(item.price) });
                    await db.upsertPriceLineItem(existing.hubspot_line_item_id, item.name, 'deal', project.project_id, null, hubspotDealId, item.price);
                    console.log(`    ~ ${item.name}: ${item.price} kr (opdateret ${existing.hubspot_line_item_id})`);
                    dealLineItemsCreated++;
                } catch (error) {
                    console.error(`    FEJL opdatering ${item.name}: ${error.message}`);
                }
            } else {
                const properties = {
                    name: item.name,
                    quantity: '1',
                    price: String(item.price),
                    hs_product_id: PRODUCT_MAP[item.name]
                };

                try {
                    const result = await hubspot.createLineItem(properties, hubspotDealId);
                    await db.upsertPriceLineItem(result.id, item.name, 'deal', project.project_id, null, hubspotDealId, item.price);
                    console.log(`    + ${item.name}: ${item.price} kr (line item ${result.id})`);
                    dealLineItemsCreated++;
                } catch (error) {
                    console.error(`    FEJL ${item.name}: ${error.message}`);
                }
            }

            await sleep(150);
        }
    }

    // 5. Create line items on orders (subproject level)
    console.log('\n--- Opretter line items på orders (subprojekt-niveau) ---\n');

    for (const sp of subprojectPrices) {
        const order = orderBySubprojectId[sp.subproject_id];
        if (!order) {
            ordersSkipped++;
            console.log(`  SKIP subprojekt ${sp.subproject_id} (${sp.subproject_name}) - ingen synced order`);
            continue;
        }

        const hubspotOrderId = order.hubspot_order_id;
        const items = buildLineItems(sp);

        if (items.length === 0) {
            console.log(`  SKIP order ${hubspotOrderId} (${sp.subproject_name}) - ingen priser > 0`);
            continue;
        }

        console.log(`  Order ${hubspotOrderId} | ${sp.project_name} > ${sp.subproject_name}:`);

        for (const item of items) {
            const existing = await db.findPriceLineItem(hubspotOrderId, item.name, 'order');

            if (existing) {
                try {
                    await hubspot.updateLineItem(existing.hubspot_line_item_id, { price: String(item.price) });
                    await db.upsertPriceLineItem(existing.hubspot_line_item_id, item.name, 'order', sp.project_id, sp.subproject_id, hubspotOrderId, item.price);
                    console.log(`    ~ ${item.name}: ${item.price} kr (opdateret ${existing.hubspot_line_item_id})`);
                    orderLineItemsCreated++;
                } catch (error) {
                    console.error(`    FEJL opdatering ${item.name}: ${error.message}`);
                }
            } else {
                const properties = {
                    name: item.name,
                    quantity: '1',
                    price: String(item.price),
                    hs_product_id: PRODUCT_MAP[item.name]
                };

                try {
                    const result = await hubspot.createLineItemForOrder(properties, hubspotOrderId);
                    await db.upsertPriceLineItem(result.id, item.name, 'order', sp.project_id, sp.subproject_id, hubspotOrderId, item.price);
                    console.log(`    + ${item.name}: ${item.price} kr (line item ${result.id})`);
                    orderLineItemsCreated++;
                } catch (error) {
                    console.error(`    FEJL ${item.name}: ${error.message}`);
                }
            }

            await sleep(150);
        }
    }

    // 6. Summary
    console.log('\n=== Sync Prices: Resultat ===');
    console.log(`Deals:  ${dealLineItemsCreated} line items oprettet, ${dealsSkipped} projekter skippet (ingen synced deal)`);
    console.log(`Orders: ${orderLineItemsCreated} line items oprettet, ${ordersSkipped} subprojekter skippet (ingen synced order)`);
    console.log('=== Færdig ===');

    process.exit(0);
}

syncPrices().catch(err => {
    console.error('Fatal fejl:', err);
    process.exit(1);
});
