# 🔹 Phase 4: Microservice Design Patterns (DDD-Aligned)

## Overview
This guide covers essential microservice patterns that complement Domain-Driven Design principles. These patterns solve common challenges in distributed systems while maintaining domain integrity and business logic clarity.

---

## 📋 Table of Contents
1. [Saga Pattern](#saga-pattern)
2. [CQRS (Command Query Responsibility Segregation)](#cqrs)
3. [Event Sourcing](#event-sourcing)
4. [Anti-Corruption Layer (ACL)](#anti-corruption-layer)
5. [Transactional Outbox](#transactional-outbox)
6. [Sidecar Pattern](#sidecar-pattern)
7. [API Gateway Pattern](#api-gateway)
8. [Pattern Selection Guide](#pattern-selection)

---

## 🔄 Saga Pattern

### Problem
How to maintain data consistency across multiple microservices without distributed transactions?

### Solution
Coordinate a sequence of local transactions using compensating actions for rollback.

### Types of Sagas

#### 1. Choreography-Based Saga
Services communicate through events without central coordination.

```javascript
// Order Service - Initiates the saga
class OrderService {
  async createOrder(orderData) {
    const order = new Order(orderData);
    order.status = 'PENDING';
    
    await this.orderRepository.save(order);
    
    // Publish event to start saga
    await this.eventBus.publish('OrderCreated', {
      orderId: order.id,
      customerId: order.customerId,
      items: order.items,
      totalAmount: order.totalAmount
    });
    
    return order;
  }
  
  // Handle saga events
  async handleInventoryReserved(event) {
    const order = await this.orderRepository.findById(event.orderId);
    order.status = 'INVENTORY_RESERVED';
    await this.orderRepository.save(order);
  }
  
  async handlePaymentFailed(event) {
    const order = await this.orderRepository.findById(event.orderId);
    order.status = 'CANCELLED';
    await this.orderRepository.save(order);
    
    // Publish compensation event
    await this.eventBus.publish('OrderCancelled', {
      orderId: event.orderId,
      reason: 'Payment failed'
    });
  }
}

// Inventory Service - Participates in saga
class InventoryService {
  async handleOrderCreated(event) {
    try {
      // Try to reserve inventory
      await this.reserveStock(event.items, event.orderId);
      
      await this.eventBus.publish('InventoryReserved', {
        orderId: event.orderId,
        reservationId: reservationId
      });
    } catch (error) {
      await this.eventBus.publish('InventoryReservationFailed', {
        orderId: event.orderId,
        reason: error.message
      });
    }
  }
  
  async handleOrderCancelled(event) {
    // Compensating action - release reserved stock
    await this.releaseReservation(event.orderId);
    
    await this.eventBus.publish('InventoryReleased', {
      orderId: event.orderId
    });
  }
}

// Payment Service - Participates in saga
class PaymentService {
  async handleInventoryReserved(event) {
    try {
      const payment = await this.processPayment(
        event.orderId,
        event.customerId,
        event.totalAmount
      );
      
      await this.eventBus.publish('PaymentProcessed', {
        orderId: event.orderId,
        paymentId: payment.id,
        amount: payment.amount
      });
    } catch (error) {
      await this.eventBus.publish('PaymentFailed', {
        orderId: event.orderId,
        reason: error.message
      });
    }
  }
}
```

#### 2. Orchestration-Based Saga
Central coordinator manages the saga flow.

```javascript
class OrderSagaOrchestrator {
  constructor(orderService, inventoryService, paymentService, eventBus) {
    this.orderService = orderService;
    this.inventoryService = inventoryService;
    this.paymentService = paymentService;
    this.eventBus = eventBus;
  }
  
  async executeOrderSaga(orderData) {
    const sagaId = generateId();
    const sagaState = new SagaState(sagaId, 'ORDER_SAGA');
    
    try {
      // Step 1: Create order
      const order = await this.orderService.createOrder(orderData);
      sagaState.addStep('ORDER_CREATED', { orderId: order.id });
      
      // Step 2: Reserve inventory
      const reservation = await this.inventoryService.reserveStock(
        order.items, 
        order.id
      );
      sagaState.addStep('INVENTORY_RESERVED', { reservationId: reservation.id });
      
      // Step 3: Process payment
      const payment = await this.paymentService.processPayment(
        order.customerId,
        order.totalAmount,
        order.id
      );
      sagaState.addStep('PAYMENT_PROCESSED', { paymentId: payment.id });
      
      // Step 4: Confirm order
      await this.orderService.confirmOrder(order.id);
      sagaState.complete();
      
      return order;
      
    } catch (error) {
      // Execute compensating actions in reverse order
      await this.compensate(sagaState, error);
      throw error;
    }
  }
  
  async compensate(sagaState, error) {
    const steps = sagaState.getSteps().reverse();
    
    for (const step of steps) {
      try {
        switch (step.action) {
          case 'PAYMENT_PROCESSED':
            await this.paymentService.refundPayment(step.data.paymentId);
            break;
            
          case 'INVENTORY_RESERVED':
            await this.inventoryService.releaseReservation(step.data.reservationId);
            break;
            
          case 'ORDER_CREATED':
            await this.orderService.cancelOrder(step.data.orderId);
            break;
        }
      } catch (compensationError) {
        // Log compensation failure - may need manual intervention
        console.error(`Compensation failed for step ${step.action}:`, compensationError);
      }
    }
  }
}

class SagaState {
  constructor(sagaId, sagaType) {
    this.sagaId = sagaId;
    this.sagaType = sagaType;
    this.steps = [];
    this.status = 'IN_PROGRESS';
    this.startedAt = new Date();
  }
  
  addStep(action, data) {
    this.steps.push({
      action,
      data,
      completedAt: new Date()
    });
  }
  
  complete() {
    this.status = 'COMPLETED';
    this.completedAt = new Date();
  }
  
  fail(error) {
    this.status = 'FAILED';
    this.error = error.message;
    this.failedAt = new Date();
  }
}
```

### Saga Best Practices

```javascript
// 1. Idempotent operations
class PaymentService {
  async processPayment(orderId, customerId, amount) {
    // Check if payment already processed
    const existingPayment = await this.paymentRepository.findByOrderId(orderId);
    if (existingPayment) {
      return existingPayment; // Idempotent response
    }
    
    // Process new payment
    const payment = await this.chargeCustomer(customerId, amount);
    payment.orderId = orderId;
    
    return await this.paymentRepository.save(payment);
  }
}

// 2. Timeout handling
class SagaTimeoutHandler {
  constructor(sagaRepository, eventBus) {
    this.sagaRepository = sagaRepository;
    this.eventBus = eventBus;
    
    // Check for timed out sagas every minute
    setInterval(() => this.checkTimeouts(), 60000);
  }
  
  async checkTimeouts() {
    const timedOutSagas = await this.sagaRepository.findTimedOut(
      new Date(Date.now() - 30 * 60 * 1000) // 30 minutes timeout
    );
    
    for (const saga of timedOutSagas) {
      await this.eventBus.publish('SagaTimedOut', {
        sagaId: saga.id,
        sagaType: saga.type
      });
    }
  }
}
```

---

## 🔄 CQRS (Command Query Responsibility Segregation)

### Problem
Read and write operations have different requirements (performance, consistency, data models).

### Solution
Separate read and write models, optimizing each for its specific purpose.

### Implementation

```javascript
// Command Side (Write Model)
class CreateOrderCommand {
  constructor(customerId, items, shippingAddress) {
    this.customerId = customerId;
    this.items = items;
    this.shippingAddress = shippingAddress;
  }
}

class OrderCommandHandler {
  constructor(orderRepository, eventBus) {
    this.orderRepository = orderRepository;
    this.eventBus = eventBus;
  }
  
  async handle(command) {
    // Validate command
    if (!command.customerId) {
      throw new Error('Customer ID is required');
    }
    
    // Create aggregate
    const order = Order.create(
      command.customerId,
      command.items,
      command.shippingAddress
    );
    
    // Save to write store
    await this.orderRepository.save(order);
    
    // Publish events for read model updates
    for (const event of order.getDomainEvents()) {
      await this.eventBus.publish(event);
    }
    
    return order.id;
  }
}

// Query Side (Read Model)
class OrderQuery {
  constructor(customerId = null, status = null, dateRange = null) {
    this.customerId = customerId;
    this.status = status;
    this.dateRange = dateRange;
  }
}

class OrderQueryHandler {
  constructor(readModelRepository) {
    this.readModelRepository = readModelRepository;
  }
  
  async handle(query) {
    return await this.readModelRepository.findOrders({
      customerId: query.customerId,
      status: query.status,
      createdAfter: query.dateRange?.start,
      createdBefore: query.dateRange?.end
    });
  }
}

// Read Model Projector
class OrderProjector {
  constructor(readModelRepository) {
    this.readModelRepository = readModelRepository;
  }
  
  async handleOrderCreated(event) {
    const orderView = {
      orderId: event.orderId,
      customerId: event.customerId,
      status: 'PENDING',
      totalAmount: event.totalAmount,
      itemCount: event.items.length,
      createdAt: event.occurredAt,
      customerName: await this.getCustomerName(event.customerId)
    };
    
    await this.readModelRepository.saveOrderView(orderView);
  }
  
  async handleOrderStatusChanged(event) {
    await this.readModelRepository.updateOrderStatus(
      event.orderId,
      event.newStatus
    );
  }
}

// Different storage for read and write
class OrderWriteRepository {
  // Optimized for writes, normalized structure
  async save(order) {
    await this.db.transaction(async (trx) => {
      await trx('orders').insert({
        id: order.id,
        customer_id: order.customerId,
        status: order.status,
        created_at: order.createdAt
      });
      
      const lineItems = order.lineItems.map(item => ({
        order_id: order.id,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice
      }));
      
      await trx('order_line_items').insert(lineItems);
    });
  }
}

class OrderReadRepository {
  // Optimized for reads, denormalized structure
  async findOrders(criteria) {
    let query = this.db('order_views');
    
    if (criteria.customerId) {
      query = query.where('customer_id', criteria.customerId);
    }
    
    if (criteria.status) {
      query = query.where('status', criteria.status);
    }
    
    return await query.select('*').orderBy('created_at', 'desc');
  }
  
  async saveOrderView(orderView) {
    await this.db('order_views').insert(orderView);
  }
}
```

### CQRS with Different Databases

```javascript
// Write side: PostgreSQL for ACID properties
class OrderWriteStore {
  constructor(postgresConnection) {
    this.db = postgresConnection;
  }
  
  async saveOrder(order) {
    // Relational, normalized storage
    await this.db.transaction(async (trx) => {
      await trx('orders').insert(order.toPostgresFormat());
      await trx('order_events').insert(order.getUncommittedEvents());
    });
  }
}

// Read side: MongoDB for flexible queries and performance
class OrderReadStore {
  constructor(mongoConnection) {
    this.db = mongoConnection;
  }
  
  async updateOrderView(orderView) {
    // Document-based, denormalized storage
    await this.db.collection('order_views').replaceOne(
      { orderId: orderView.orderId },
      orderView,
      { upsert: true }
    );
  }
  
  async findOrdersByCustomer(customerId) {
    return await this.db.collection('order_views')
      .find({ customerId })
      .sort({ createdAt: -1 })
      .toArray();
  }
}
```

---

## 📚 Event Sourcing

### Problem
How to maintain a complete audit trail and enable temporal queries while supporting different read models?

### Solution
Store events instead of current state, rebuild state by replaying events.

### Implementation

```javascript
// Event Store
class EventStore {
  constructor(database) {
    this.db = database;
  }
  
  async saveEvents(streamId, events, expectedVersion) {
    await this.db.transaction(async (trx) => {
      // Optimistic concurrency check
      const currentVersion = await this.getCurrentVersion(streamId, trx);
      if (currentVersion !== expectedVersion) {
        throw new Error('Concurrency violation');
      }
      
      // Save events
      for (let i = 0; i < events.length; i++) {
        await trx('events').insert({
          stream_id: streamId,
          version: expectedVersion + i + 1,
          event_type: events[i].constructor.name,
          event_data: JSON.stringify(events[i]),
          created_at: new Date()
        });
      }
    });
  }
  
  async getEvents(streamId, fromVersion = 0) {
    const rows = await this.db('events')
      .where('stream_id', streamId)
      .where('version', '>', fromVersion)
      .orderBy('version');
    
    return rows.map(row => ({
      version: row.version,
      eventType: row.event_type,
      eventData: JSON.parse(row.event_data),
      createdAt: row.created_at
    }));
  }
}

// Event-Sourced Aggregate
class Order {
  constructor() {
    this.id = null;
    this.customerId = null;
    this.status = null;
    this.lineItems = [];
    this.version = 0;
    this.uncommittedEvents = [];
  }
  
  // Factory method
  static create(customerId, items) {
    const order = new Order();
    const event = new OrderCreated(generateId(), customerId, items);
    order.apply(event);
    order.markAsNew(event);
    return order;
  }
  
  // Command methods
  addLineItem(productId, quantity, unitPrice) {
    if (this.status === 'SHIPPED') {
      throw new Error('Cannot modify shipped order');
    }
    
    const event = new LineItemAdded(this.id, productId, quantity, unitPrice);
    this.apply(event);
    this.markAsNew(event);
  }
  
  confirm() {
    if (this.status !== 'PENDING') {
      throw new Error('Only pending orders can be confirmed');
    }
    
    const event = new OrderConfirmed(this.id);
    this.apply(event);
    this.markAsNew(event);
  }
  
  // Event application (state changes)
  apply(event) {
    switch (event.constructor.name) {
      case 'OrderCreated':
        this.id = event.orderId;
        this.customerId = event.customerId;
        this.status = 'PENDING';
        this.lineItems = event.items.map(item => new OrderLineItem(item));
        break;
        
      case 'LineItemAdded':
        this.lineItems.push(new OrderLineItem(event));
        break;
        
      case 'OrderConfirmed':
        this.status = 'CONFIRMED';
        break;
    }
    
    this.version++;
  }
  
  markAsNew(event) {
    this.uncommittedEvents.push(event);
  }
  
  getUncommittedEvents() {
    return this.uncommittedEvents;
  }
  
  markEventsAsCommitted() {
    this.uncommittedEvents = [];
  }
  
  // Rebuild from events
  static fromEvents(events) {
    const order = new Order();
    
    for (const event of events) {
      order.apply(event.eventData);
    }
    
    return order;
  }
}

// Repository for Event-Sourced Aggregates
class EventSourcedOrderRepository {
  constructor(eventStore) {
    this.eventStore = eventStore;
  }
  
  async save(order) {
    const events = order.getUncommittedEvents();
    if (events.length === 0) return;
    
    await this.eventStore.saveEvents(
      order.id,
      events,
      order.version - events.length
    );
    
    order.markEventsAsCommitted();
  }
  
  async findById(orderId) {
    const events = await this.eventStore.getEvents(orderId);
    if (events.length === 0) return null;
    
    return Order.fromEvents(events);
  }
  
  // Temporal queries
  async findByIdAtTime(orderId, timestamp) {
    const events = await this.eventStore.getEvents(orderId);
    const eventsUntilTime = events.filter(e => e.createdAt <= timestamp);
    
    if (eventsUntilTime.length === 0) return null;
    
    return Order.fromEvents(eventsUntilTime);
  }
}

// Projections from Events
class OrderProjectionBuilder {
  constructor(eventStore, projectionStore) {
    this.eventStore = eventStore;
    this.projectionStore = projectionStore;
  }
  
  async buildOrderSummaryProjection() {
    const allEvents = await this.eventStore.getAllEvents();
    const orderSummaries = new Map();
    
    for (const event of allEvents) {
      const orderId = this.extractOrderId(event);
      
      if (!orderSummaries.has(orderId)) {
        orderSummaries.set(orderId, {
          orderId,
          customerId: null,
          status: 'PENDING',
          lineItemCount: 0,
          totalAmount: 0,
          createdAt: null,
          lastModified: event.createdAt
        });
      }
      
      const summary = orderSummaries.get(orderId);
      
      switch (event.eventType) {
        case 'OrderCreated':
          summary.customerId = event.eventData.customerId;
          summary.createdAt = event.createdAt;
          summary.lineItemCount = event.eventData.items.length;
          break;
          
        case 'OrderConfirmed':
          summary.status = 'CONFIRMED';
          break;
          
        case 'LineItemAdded':
          summary.lineItemCount++;
          summary.totalAmount += event.eventData.quantity * event.eventData.unitPrice;
          break;
      }
      
      summary.lastModified = event.createdAt;
    }
    
    // Save projections
    for (const [orderId, summary] of orderSummaries) {
      await this.projectionStore.saveOrderSummary(summary);
    }
  }
}
```

### Event Sourcing Benefits and Considerations

```javascript
// Benefits:
const benefits = [
  'Complete audit trail',
  'Temporal queries (state at any point in time)',
  'Easy debugging and analysis',
  'Natural fit for event-driven architectures',
  'Support for multiple read models'
];

// Considerations:
const challenges = [
  'Event schema evolution',
  'Snapshot strategies for performance',
  'Query complexity for current state',
  'Storage growth over time'
];

// Event Versioning Strategy
class EventWithVersion {
  constructor(eventData, version = 1) {
    this.version = version;
    this.eventData = eventData;
  }
}

class EventUpgrader {
  upgrade(event) {
    switch (event.eventType) {
      case 'OrderCreated':
        if (event.version === 1) {
          // Upgrade v1 to v2 - add new field
          return {
            ...event,
            version: 2,
            eventData: {
              ...event.eventData,
              orderChannel: 'web' // default value for old events
            }
          };
        }
        break;
    }
    
    return event;
  }
}
```

---

## 🛡️ Anti-Corruption Layer (ACL)

### Problem
How to protect your domain model from external system changes and poor models?

### Solution
Create a translation layer that converts between your model and external systems.

### Implementation

```javascript
// External system with poor model
class LegacyInventorySystemClient {
  async checkStock(productCode) {
    // Legacy system returns confusing structure
    const response = await this.httpClient.get(`/legacy/stock/${productCode}`);
    
    return {
      prod_cd: response.data.product_code,
      qty_avail: response.data.available_quantity,
      qty_rsrv: response.data.reserved_quantity,
      reorder_pt: response.data.reorder_point,
      last_updt: response.data.last_update_timestamp
    };
  }
  
  async reserveStock(productCode, quantity, orderRef) {
    const payload = {
      prod_cd: productCode,
      qty: quantity,
      ord_ref: orderRef,
      action: 'RESERVE'
    };
    
    const response = await this.httpClient.post('/legacy/stock/action', payload);
    return response.data.reservation_id;
  }
}

// Domain model (clean)
class StockAvailability {
  constructor(productId, availableQuantity, reservedQuantity, reorderLevel) {
    this.productId = productId;
    this.availableQuantity = availableQuantity;
    this.reservedQuantity = reservedQuantity;
    this.reorderLevel = reorderLevel;
    this.lastUpdated = new Date();
  }
  
  isAvailable(requestedQuantity) {
    return this.availableQuantity >= requestedQuantity;
  }
  
  isLowStock() {
    return this.availableQuantity <= this.reorderLevel;
  }
}

// Anti-Corruption Layer
class InventoryAntiCorruptionLayer {
  constructor(legacyClient) {
    this.legacyClient = legacyClient;
  }
  
  async getStockAvailability(productId) {
    // Call legacy system
    const legacyData = await this.legacyClient.checkStock(productId);
    
    // Translate to domain model
    return new StockAvailability(
      legacyData.prod_cd,
      legacyData.qty_avail,
      legacyData.qty_rsrv,
      legacyData.reorder_pt
    );
  }
  
  async reserveStock(productId, quantity, orderId) {
    // Validate with domain rules first
    const availability = await this.getStockAvailability(productId);
    
    if (!availability.isAvailable(quantity)) {
      throw new DomainError('Insufficient stock available');
    }
    
    // Transform domain request to legacy format
    const reservationId = await this.legacyClient.reserveStock(
      productId,
      quantity,
      this.transformOrderId(orderId)
    );
    
    // Return domain object
    return new StockReservation(reservationId, productId, quantity, orderId);
  }
  
  transformOrderId(domainOrderId) {
    // Legacy system expects different format
    return `ORD-${domainOrderId}`;
  }
}

// Domain Service uses ACL instead of legacy client directly
class InventoryDomainService {
  constructor(inventoryACL) {
    this.inventoryACL = inventoryACL;
  }
  
  async checkProductAvailability(productId, requestedQuantity) {
    const availability = await this.inventoryACL.getStockAvailability(productId);
    
    return {
      productId,
      isAvailable: availability.isAvailable(requestedQuantity),
      availableQuantity: availability.availableQuantity,
      isLowStock: availability.isLowStock()
    };
  }
  
  async reserveProductStock(productId, quantity, orderId) {
    return await this.inventoryACL.reserveStock(productId, quantity, orderId);
  }
}
```

### ACL for Different Integration Patterns

```javascript
// REST API ACL
class RestInventoryACL {
  constructor(httpClient, baseUrl) {
    this.client = httpClient;
    this.baseUrl = baseUrl;
  }
  
  async getStockAvailability(productId) {
    const response = await this.client.get(`${this.baseUrl}/products/${productId}/stock`);
    
    // Transform external API response to domain model
    return new StockAvailability(
      response.data.productId,
      response.data.available,
      response.data.reserved,
      response.data.reorderPoint
    );
  }
}

// Message Queue ACL
class MessageQueueInventoryACL {
  constructor(messageQueue) {
    this.messageQueue = messageQueue;
  }
  
  async reserveStock(productId, quantity, orderId) {
    const correlationId = generateId();
    
    // Send request message
    await this.messageQueue.send('inventory.reserve.request', {
      correlationId,
      productId,
      quantity,
      orderId
    });
    
    // Wait for response (with timeout)
    const response = await this.messageQueue.waitForResponse(
      correlationId,
      5000 // 5 second timeout
    );
    
    if (response.status === 'SUCCESS') {
      return new StockReservation(
        response.reservationId,
        productId,
        quantity,
        orderId
      );
    } else {
      throw new DomainError(`Stock reservation failed: ${response.reason}`);
    }
  }
}

// Database ACL (for legacy database access)
class DatabaseInventoryACL {
  constructor(legacyDatabase) {
    this.db = legacyDatabase;
  }
  
  async getStockAvailability(productId) {
    // Query legacy database with complex joins
    const result = await this.db.query(`
      SELECT 
        p.product_code,
        s.available_qty,
        s.reserved_qty,
        p.reorder_level,
        s.last_modified
      FROM products p
      JOIN stock_levels s ON p.id = s.product_id
      WHERE p.product_code = ?
    `, [productId]);
    
    if (result.length === 0) {
      throw new DomainError(`Product ${productId} not found`);
    }
    
    const row = result[0];
    
    // Transform database row to domain model
    return new StockAvailability(
      row.product_code,
      row.available_qty,
      row.reserved_qty,
      row.reorder_level
    );
  }
}
```

---

## 📤 Transactional Outbox

### Problem
How to ensure events are published when aggregate state changes, maintaining consistency?

### Solution
Store events in the same transaction as aggregate changes, then publish them separately.

### Implementation

```javascript
// Outbox Table Schema
/*
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  event_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP NULL,
  version INTEGER NOT NULL
);

CREATE INDEX idx_outbox_unprocessed ON outbox_events (created_at) 
WHERE processed_at IS NULL;
*/

// Repository with Outbox Pattern
class OrderRepository {
  constructor(database, eventSerializer) {
    this.db = database;
    this.eventSerializer = eventSerializer;
  }
  
  async save(order) {
    await this.db.transaction(async (trx) => {
      // Save aggregate state
      await this.saveOrderData(order, trx);
      
      // Save events to outbox in same transaction
      const events = order.getUncommittedEvents();
      for (const event of events) {
        await this.saveEventToOutbox(order.id, event, trx);
      }
      
      // Clear uncommitted events
      order.markEventsAsCommitted();
    });
  }
  
  async saveOrderData(order, transaction) {
    const orderData = {
      id: order.id,
      customer_id: order.customerId,
      status: order.status,
      total_amount: order.totalAmount,
      version: order.version
    };
    
    await transaction('orders')
      .insert(orderData)
      .onConflict('id')
      .merge(['status', 'total_amount', 'version']);
      
    // Save line items
    await transaction('order_line_items')
      .where('order_id', order.id)
      .del();
      
    const lineItemsData = order.lineItems.map(item => ({
      order_id: order.id,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice
    }));
    
    if (lineItemsData.length > 0) {
      await transaction('order_line_items').insert(lineItemsData);
    }
  }
  
  async saveEventToOutbox(aggregateId, event, transaction) {
    const outboxEvent = {
      id: generateId(),
      aggregate_id: aggregateId,
      event_type: event.constructor.name,
      event_data: this.eventSerializer.serialize(event),
      version: event.version || 1
    };
    
    await transaction('outbox_events').insert(outboxEvent);
  }
}

// Outbox Event Publisher
class OutboxEventPublisher {
  constructor(database, eventBus, batchSize = 100) {
    this.db = database;
    this.eventBus = eventBus;
    this.batchSize = batchSize;
    this.isRunning = false;
  }
  
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.processingInterval = setInterval(
      () => this.processEvents(),
      1000 // Process every second
    );
  }
  
  stop() {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
  }
  
  async processEvents() {
    try {
      const unprocessedEvents = await this.getUnprocessedEvents();
      
      for (const eventRow of unprocessedEvents) {
        await this.processEvent(eventRow);
      }
    } catch (error) {
      console.error('Error processing outbox events:', error);
    }
  }
  
  async getUnprocessedEvents() {
    return await this.db('outbox_events')
      .whereNull('processed_at')
      .orderBy('created_at')
      .limit(this.batchSize);
  }
  
  async processEvent(eventRow) {
    try {
      // Deserialize event
      const event = this.deserializeEvent(eventRow);
      
      // Publish to event bus
      await this.eventBus.publish(event);
      
      // Mark as processed
      await this.markAsProcessed(eventRow.id);
      
    } catch (error) {
      console.error(`Failed to process event ${eventRow.id}:`, error);
      
      // Could implement retry logic or dead letter queue here
      await this.markAsFailure(eventRow.id, error.message);
    }
  }
  
  async markAsProcessed(eventId) {
    await this.db('outbox_events')
      .where('id', eventId)
      .update({ processed_at: new Date() });
  }
  
  async markAsFailure(eventId, errorMessage) {
    await this.db('outbox_events')
      .where('id', eventId)
      .update({ 
        error_message: errorMessage,
        failed_at: new Date()
      });
  }
  
  deserializeEvent(eventRow) {
    const EventClass = this.getEventClass(eventRow.event_type);
    const eventData = JSON.parse(eventRow.event_data);
    
    return new EventClass(eventData);
  }
}

// Outbox with retry and dead letter queue
class RobustOutboxEventPublisher extends OutboxEventPublisher {
  constructor(database, eventBus, options = {}) {
    super(database, eventBus, options.batchSize);
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 5000;
  }
  
  async processEvent(eventRow) {
    const retryCount = eventRow.retry_count || 0;
    
    try {
      await super.processEvent(eventRow);
    } catch (error) {
      if (retryCount < this.maxRetries) {
        // Schedule retry
        await this.scheduleRetry(eventRow.id, retryCount + 1);
      } else {
        // Move to dead letter queue
        await this.moveToDeadLetterQueue(eventRow, error.message);
      }
    }
  }
  
  async scheduleRetry(eventId, retryCount) {
    const nextAttempt = new Date(Date.now() + this.retryDelay * retryCount);
    
    await this.db('outbox_events')
      .where('id', eventId)
      .update({
        retry_count: retryCount,
        next_attempt_at: nextAttempt
      });
  }
  
  async moveToDeadLetterQueue(eventRow, errorMessage) {
    await this.db.transaction(async (trx) => {
      // Insert into dead letter queue
      await trx('outbox_dead_letters').insert({
        original_event_id: eventRow.id,
        aggregate_id: eventRow.aggregate_id,
        event_type: eventRow.event_type,
        event_data: eventRow.event_data,
        original_created_at: eventRow.created_at,
        failed_at: new Date(),
        error_message: errorMessage,
        retry_count: eventRow.retry_count
      });
      
      // Remove from outbox
      await trx('outbox_events')
        .where('id', eventRow.id)
        .del();
    });
  }
}
```

---

## 🚗 Sidecar Pattern

### Problem
How to add cross-cutting concerns (logging, monitoring, security) without modifying service code?

### Solution
Deploy helper services alongside main services to handle infrastructure concerns.

### Implementation

```yaml
# Docker Compose with Sidecar
version: '3.8'
services:
  order-service:
    image: order-service:latest
    ports:
      - "3001:3000"
    environment:
      - DATABASE_URL=postgres://orders-db:5432/orders
    depends_on:
      - orders-db
      - order-service-proxy
  
  order-service-proxy:
    image: envoy:v1.20
    ports:
      - "8001:8080"
    volumes:
      - ./envoy-config.yaml:/etc/envoy/envoy.yaml
    depends_on:
      - order-service
  
  order-service-logging:
    image: fluentd:latest
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluent.conf
      - /var/log/order-service:/var/log/order-service
```

```yaml
# Kubernetes Sidecar Configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
      # Main application container
      - name: order-service
        image: order-service:latest
        ports:
        - containerPort: 3000
        volumeMounts:
        - name: shared-logs
          mountPath: /var/log
      
      # Logging sidecar
      - name: log-shipper
        image: fluentd:latest
        volumeMounts:
        - name: shared-logs
          mountPath: /var/log
        - name: fluentd-config
          mountPath: /fluentd/etc
      
      # Monitoring sidecar
      - name: metrics-exporter
        image: prometheus/node-exporter:latest
        ports:
        - containerPort: 9100
      
      volumes:
      - name: shared-logs
        emptyDir: {}
      - name: fluentd-config
        configMap:
          name: fluentd-config
```

### Sidecar Use Cases

```javascript
// 1. Authentication Proxy Sidecar
class AuthenticationProxy {
  constructor(targetService, authService) {
    this.targetService = targetService;
    this.authService = authService;
  }
  
  async handleRequest(req, res) {
    try {
      // Validate token
      const token = this.extractToken(req);
      const user = await this.authService.validateToken(token);
      
      // Add user context to request
      req.headers['x-user-id'] = user.id;
      req.headers['x-user-roles'] = user.roles.join(',');
      
      // Forward to main service
      return await this.forwardRequest(req, res);
      
    } catch (error) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }
}

// 2. Circuit Breaker Sidecar
class CircuitBreakerProxy {
  constructor(targetService, options = {}) {
    this.targetService = targetService;
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 30000;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
  
  async handleRequest(req, res) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime < this.timeout) {
        return res.status(503).json({ error: 'Circuit breaker is open' });
      } else {
        this.state = 'HALF_OPEN';
      }
    }
    
    try {
      const response = await this.forwardRequest(req, res);
      
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      
      return response;
      
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
      }
      
      throw error;
    }
  }
}

// 3. Metrics Collection Sidecar
class MetricsCollector {
  constructor(targetService, metricsStore) {
    this.targetService = targetService;
    this.metricsStore = metricsStore;
  }
  
  async handleRequest(req, res) {
    const startTime = Date.now();
    const requestId = generateId();
    
    try {
      // Forward request
      const response = await this.forwardRequest(req, res);
      
      // Collect success metrics
      await this.recordMetrics({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: response.statusCode,
        duration: Date.now() - startTime,
        success: true
      });
      
      return response;
      
    } catch (error) {
      // Collect error metrics
      await this.recordMetrics({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }
}
```

---

## 🚪 API Gateway Pattern

### Problem
How to provide a unified entry point for multiple microservices while handling cross-cutting concerns?

### Solution
Single entry point that routes requests, handles authentication, rate limiting, and aggregation.

### Implementation

```javascript
// API Gateway with Express
class APIGateway {
  constructor() {
    this.app = express();
    this.services = new Map();
    this.setupMiddleware();
    this.setupRoutes();
  }
  
  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(this.authenticationMiddleware);
    this.app.use(this.rateLimitingMiddleware);
    this.app.use(this.loggingMiddleware);
  }
  
  registerService(name, baseUrl, routes) {
    this.services.set(name, { baseUrl, routes });
  }
  
  setupRoutes() {
    // Order service routes
    this.registerService('order-service', 'http://order-service:3000', [
      { path: '/api/orders', methods: ['GET', 'POST'] },
      { path: '/api/orders/:id', methods: ['GET', 'PUT', 'DELETE'] }
    ]);
    
    // Product service routes
    this.registerService('product-service', 'http://product-service:3000', [
      { path: '/api/products', methods: ['GET'] },
      { path: '/api/products/:id', methods: ['GET'] }
    ]);
    
    // Dynamic route setup
    for (const [serviceName, config] of this.services) {
      for (const route of config.routes) {
        this.app.all(route.path, async (req, res) => {
          await this.proxyRequest(serviceName, req, res);
        });
      }
    }
    
    // Composite endpoints
    this.app.get('/api/orders/:id/details', this.getOrderDetails.bind(this));
  }
  
  async proxyRequest(serviceName, req, res) {
    const service = this.services.get(serviceName);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    try {
      const targetUrl = `${service.baseUrl}${req.path}`;
      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.body,
        params: req.query,
        headers: this.forwardHeaders(req.headers)
      });
      
      res.status(response.status).json(response.data);
      
    } catch (error) {
      const status = error.response?.status || 500;
      const message = error.response?.data || { error: 'Internal server error' };
      res.status(status).json(message);
    }
  }
  
  // Composite endpoint that aggregates data from multiple services
  async getOrderDetails(req, res) {
    try {
      const orderId = req.params.id;
      
      // Get order from order service
      const orderResponse = await axios.get(
        `http://order-service:3000/api/orders/${orderId}`
      );
      const order = orderResponse.data;
      
      // Get customer details from customer service
      const customerResponse = await axios.get(
        `http://customer-service:3000/api/customers/${order.customerId}`
      );
      const customer = customerResponse.data;
      
      // Get product details for each line item
      const productPromises = order.lineItems.map(async (item) => {
        const productResponse = await axios.get(
          `http://product-service:3000/api/products/${item.productId}`
        );
        return {
          ...item,
          productDetails: productResponse.data
        };
      });
      
      const enrichedLineItems = await Promise.all(productPromises);
      
      // Return aggregated response
      res.json({
        order: {
          ...order,
          lineItems: enrichedLineItems
        },
        customer
      });
      
    } catch (error) {
      res.status(500).json({ error: 'Failed to get order details' });
    }
  }
  
  authenticationMiddleware = async (req, res, next) => {
    // Skip auth for health checks
    if (req.path === '/health') {
      return next();
    }
    
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
      const user = await this.authService.validateToken(token);
      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
  
  rateLimitingMiddleware = (req, res, next) => {
    // Simple in-memory rate limiting (use Redis in production)
    const clientId = req.user?.id || req.ip;
    const key = `rate_limit:${clientId}`;
    
    // Allow 100 requests per minute
    const limit = 100;
    const window = 60 * 1000; // 1 minute
    
    // Implementation would use sliding window or token bucket
    // For simplicity, shown as concept
    next();
  };
  
  loggingMiddleware = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    
    next();
  };
  
  forwardHeaders(headers) {
    // Forward specific headers, remove others
    const allowedHeaders = [
      'authorization',
      'content-type',
      'x-user-id',
      'x-correlation-id'
    ];
    
    const forwardedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      if (allowedHeaders.includes(key.toLowerCase())) {
        forwardedHeaders[key] = value;
      }
    }
    
    return forwardedHeaders;
  }
}
```

---

## 🎯 Pattern Selection Guide

### When to Use Each Pattern

| Pattern | Use When | Avoid When | Complexity |
|---------|----------|------------|------------|
| **Saga** | Distributed transactions needed | Simple operations | High |
| **CQRS** | Read/write models differ significantly | Simple CRUD | Medium |
| **Event Sourcing** | Audit trail required, temporal queries | Simple state management | High |
| **ACL** | Integrating with legacy/external systems | Full control over dependencies | Medium |
| **Transactional Outbox** | Event publishing must be consistent | Can tolerate eventual consistency | Medium |
| **Sidecar** | Cross-cutting concerns, polyglot architecture | Monolithic deployments | Low |

### Pattern Combinations

```javascript
// Common pattern combinations that work well together

// 1. CQRS + Event Sourcing + Saga
class OrderWorkflow {
  // Event Sourcing for write model
  // CQRS for optimized read models  
  // Saga for cross-service coordination
}

// 2. Transactional Outbox + Sidecar
class EventPublishingWithSidecar {
  // Outbox ensures events are published
  // Sidecar handles event delivery and retry
}

// 3. API Gateway + ACL + Circuit Breaker
class ResilientGateway {
  // Gateway provides single entry point
  // ACL protects from external system changes
  // Circuit breaker provides fault tolerance
}
```

---

## ✅ Next Steps
With these patterns in your toolkit, proceed to **Phase 5: Node.js Hands-on Example** to see them implemented in a complete working system.