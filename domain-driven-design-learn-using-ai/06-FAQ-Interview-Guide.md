# 🔹 Phase 6: FAQ & Interview Preparation

## Overview
This comprehensive FAQ addresses common questions, misconceptions, and real-world challenges when applying Domain-Driven Design. Perfect for interview preparation and clarifying complex DDD concepts.

---

## 📋 Table of Contents
1. [Core DDD Concepts](#core-ddd-concepts)
2. [Strategic Design Questions](#strategic-design)
3. [Tactical Design Questions](#tactical-design)
4. [Microservices & DDD](#microservices-ddd)
5. [Common Mistakes & Pitfalls](#common-mistakes)
6. [Real-World Implementation](#real-world-implementation)
7. [Interview Questions & Answers](#interview-questions)
8. [Advanced Topics](#advanced-topics)

---

## 🎯 Core DDD Concepts

### ❓ Q1: What is Domain-Driven Design and when should you use it?

**Answer**: DDD is a software development philosophy that emphasizes collaboration between technical and domain experts to create a model that accurately reflects the business domain.

**Use DDD when**:
- Complex business logic and rules
- Large development teams
- Long-lived applications
- Need for business-technical alignment
- Multiple bounded contexts

**Avoid DDD when**:
- Simple CRUD applications
- Small teams (< 5 people)
- Well-understood technical problems
- Short-term projects
- Limited business complexity

```javascript
// ❌ Simple CRUD - DDD overkill
class UserService {
  async createUser(userData) {
    return await this.userRepository.save(userData);
  }
}

// ✅ Complex business logic - DDD appropriate
class OrderService {
  async placeOrder(orderData) {
    // Complex business rules
    const order = Order.create(orderData);
    
    // Validate business invariants
    if (!order.meetsMinimumOrderValue()) {
      throw new DomainError('Order below minimum value');
    }
    
    // Apply business logic
    order.applyPromotions();
    order.calculateTax();
    
    return await this.orderRepository.save(order);
  }
}
```

### ❓ Q2: What's the difference between Domain Model and Data Model?

**Answer**: 
- **Domain Model**: Represents business concepts, behavior, and rules
- **Data Model**: Represents how data is stored and structured

```javascript
// Data Model (Anemic)
class OrderData {
  constructor() {
    this.id = null;
    this.customerId = null;
    this.status = null;
    this.total = 0;
    this.items = [];
  }
}

// Domain Model (Rich)
class Order {
  constructor(customerId) {
    this.id = generateId();
    this.customerId = customerId;
    this.status = OrderStatus.PENDING;
    this.items = [];
  }
  
  addItem(product, quantity) {
    // Business logic and validation
    if (this.status !== OrderStatus.PENDING) {
      throw new DomainError('Cannot modify confirmed order');
    }
    
    const item = new OrderItem(product, quantity);
    this.items.push(item);
    this.recalculateTotal();
  }
  
  confirm() {
    // Business rules
    if (this.items.length === 0) {
      throw new DomainError('Cannot confirm empty order');
    }
    
    this.status = OrderStatus.CONFIRMED;
    this.addDomainEvent(new OrderConfirmed(this.id));
  }
}
```

### ❓ Q3: How do you identify if your domain model is anemic?

**Answer**: Signs of anemic domain model:
- Entities are just data containers
- All business logic in services
- Lots of getters/setters
- No domain behavior in entities

```javascript
// ❌ Anemic Domain Model
class Order {
  getId() { return this.id; }
  setId(id) { this.id = id; }
  getStatus() { return this.status; }
  setStatus(status) { this.status = status; }
  getItems() { return this.items; }
  setItems(items) { this.items = items; }
}

class OrderService {
  confirmOrder(order) {
    if (order.getItems().length === 0) {
      throw new Error('Cannot confirm empty order');
    }
    order.setStatus('CONFIRMED');
  }
}

// ✅ Rich Domain Model
class Order {
  confirm() {
    if (this.items.length === 0) {
      throw new DomainError('Cannot confirm empty order');
    }
    this.status = OrderStatus.CONFIRMED;
    this.addDomainEvent(new OrderConfirmed(this.id));
  }
  
  addItem(product, quantity) {
    const item = OrderItem.create(product, quantity);
    this.items.push(item);
    this.recalculateTotal();
  }
}
```

---

## 🎯 Strategic Design

### ❓ Q4: How do you identify bounded contexts?

**Answer**: Look for:
1. **Different business rules** for same concepts
2. **Team boundaries** and ownership
3. **Different vocabularies** (ubiquitous language variations)
4. **Data ownership** and lifecycle
5. **Integration points** between systems

```javascript
// Example: "Customer" means different things in different contexts

// Sales Context
class Customer {
  constructor(id, name, creditLimit, salesHistory) {
    this.id = id;
    this.name = name;
    this.creditLimit = creditLimit;
    this.salesHistory = salesHistory;
  }
  
  canPlaceOrder(orderValue) {
    return this.getRemainingCredit() >= orderValue;
  }
}

// Shipping Context  
class Customer {
  constructor(id, name, shippingAddresses, deliveryPreferences) {
    this.id = id;
    this.name = name;
    this.shippingAddresses = shippingAddresses;
    this.deliveryPreferences = deliveryPreferences;
  }
  
  getPreferredShippingAddress() {
    return this.shippingAddresses.find(addr => addr.isPreferred);
  }
}
```

### ❓ Q5: What are the different types of subdomains?

**Answer**:

| Type | Description | Investment Level | Examples |
|------|-------------|------------------|----------|
| **Core** | Competitive advantage, key differentiator | High | Order processing, pricing algorithms |
| **Supporting** | Important but not differentiating | Medium | Customer management, reporting |
| **Generic** | Common across industries | Low (buy/outsource) | Authentication, email, payments |

```javascript
// Core Subdomain - Custom business logic
class PricingEngine {
  calculatePrice(product, customer, context) {
    // Complex proprietary pricing logic
    let price = product.basePrice;
    
    // Apply customer-specific discounts
    const customerDiscount = this.getCustomerDiscount(customer);
    price = price.subtract(customerDiscount);
    
    // Apply volume discounts
    const volumeDiscount = this.calculateVolumeDiscount(context.quantity);
    price = price.subtract(volumeDiscount);
    
    // Apply seasonal promotions
    const seasonalAdjustment = this.getSeasonalAdjustment(product.category);
    price = price.multiply(seasonalAdjustment);
    
    return price;
  }
}

// Generic Subdomain - Use external service
class EmailService {
  constructor(externalEmailProvider) {
    this.emailProvider = externalEmailProvider; // SendGrid, AWS SES, etc.
  }
  
  async sendEmail(to, subject, body) {
    return await this.emailProvider.send({ to, subject, body });
  }
}
```

### ❓ Q6: How do you handle communication between bounded contexts?

**Answer**: Use context mapping patterns:

```javascript
// 1. Customer-Supplier (REST API)
class OrderService {
  constructor(inventoryServiceClient) {
    this.inventoryService = inventoryServiceClient;
  }
  
  async createOrder(orderData) {
    // Check inventory availability
    const availability = await this.inventoryService.checkAvailability(
      orderData.productId, 
      orderData.quantity
    );
    
    if (!availability.available) {
      throw new Error('Insufficient inventory');
    }
    
    // Create order...
  }
}

// 2. Publisher-Subscriber (Events)
class OrderService {
  async confirmOrder(orderId) {
    const order = await this.orderRepository.findById(orderId);
    order.confirm();
    
    await this.orderRepository.save(order);
    
    // Publish event for other contexts
    await this.eventBus.publish(new OrderConfirmed({
      orderId: order.id,
      customerId: order.customerId,
      items: order.items
    }));
  }
}

// 3. Anti-Corruption Layer
class LegacyInventoryACL {
  constructor(legacyInventorySystem) {
    this.legacySystem = legacyInventorySystem;
  }
  
  async checkAvailability(productId, quantity) {
    // Call legacy system
    const legacyResponse = await this.legacySystem.getStock(productId);
    
    // Translate to domain model
    return new StockAvailability(
      productId,
      legacyResponse.available_qty,
      legacyResponse.reserved_qty
    );
  }
}
```

---

## ⚙️ Tactical Design

### ❓ Q7: What's the difference between Entity and Value Object?

**Answer**:

| Aspect | Entity | Value Object |
|--------|--------|--------------|
| **Identity** | Has unique identifier | No identity |
| **Mutability** | Mutable | Immutable |
| **Equality** | Based on ID | Based on all attributes |
| **Lifecycle** | Has lifecycle | Created and discarded |

```javascript
// Entity - has identity and lifecycle
class Customer {
  constructor(customerId, email) {
    this.customerId = customerId; // Identity
    this.email = email;
    this.isActive = true;
  }
  
  changeEmail(newEmail) {
    this.email = newEmail; // Mutable
  }
  
  equals(other) {
    return this.customerId === other.customerId; // Identity-based equality
  }
}

// Value Object - no identity, immutable
class Money {
  constructor(amount, currency) {
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this); // Immutable
  }
  
  add(other) {
    if (this.currency !== other.currency) {
      throw new Error('Currency mismatch');
    }
    return new Money(this.amount + other.amount, this.currency); // New instance
  }
  
  equals(other) {
    return this.amount === other.amount && 
           this.currency === other.currency; // Value-based equality
  }
}
```

### ❓ Q8: How do you design aggregates properly?

**Answer**: Follow these rules:

1. **One Aggregate Root** per aggregate
2. **Reference by ID** between aggregates
3. **Single transaction** per aggregate
4. **Small aggregates** for better performance

```javascript
// ❌ Large aggregate (performance issues)
class Customer {
  constructor(id) {
    this.id = id;
    this.profile = new CustomerProfile();
    this.orders = []; // ❌ Don't include other aggregates
    this.payments = []; // ❌ Don't include other aggregates
  }
}

// ✅ Proper aggregate design
class Customer {
  constructor(id, email, name) {
    this.id = id; // Aggregate root
    this.email = email;
    this.name = name;
    this.addresses = []; // ✅ Contains value objects/entities within boundary
  }
  
  addAddress(address) {
    if (this.addresses.length >= 5) {
      throw new DomainError('Maximum 5 addresses allowed');
    }
    this.addresses.push(address);
  }
}

class Order {
  constructor(id, customerId) { // ✅ Reference customer by ID
    this.id = id;
    this.customerId = customerId; // ✅ Reference, not object
    this.lineItems = []; // ✅ Contains entities within boundary
  }
}
```

### ❓ Q9: When should you use Domain Services?

**Answer**: Use Domain Services when:
- Logic involves multiple aggregates
- Business logic doesn't belong to any single entity
- Need to integrate with external domain concepts

```javascript
// ❌ Don't put complex logic spanning aggregates in entities
class Order {
  calculateShippingCost(customer, shippingAddress) {
    // ❌ This logic involves multiple aggregates and external services
    // Should not be in Order entity
  }
}

// ✅ Use Domain Service for cross-aggregate logic
class ShippingCostCalculator {
  constructor(shippingRateService, customerService) {
    this.shippingRateService = shippingRateService;
    this.customerService = customerService;
  }
  
  calculateShippingCost(order, customer, shippingAddress) {
    // Complex logic involving multiple aggregates
    let baseCost = this.shippingRateService.getBaseCost(
      order.getTotalWeight(),
      shippingAddress.zipCode
    );
    
    // Apply customer-specific discounts
    if (customer.isPremium()) {
      baseCost = baseCost.multiply(0.8); // 20% discount
    }
    
    // Apply order-specific rules
    if (order.getTotalValue().isGreaterThan(new Money(100, 'USD'))) {
      return Money.zero('USD'); // Free shipping
    }
    
    return baseCost;
  }
}
```

### ❓ Q10: How do you handle domain events properly?

**Answer**: Domain events represent something important that happened in the domain.

```javascript
class Order {
  confirm() {
    if (this.status !== OrderStatus.PENDING) {
      throw new DomainError('Only pending orders can be confirmed');
    }
    
    this.status = OrderStatus.CONFIRMED;
    
    // ✅ Add domain event
    this.addDomainEvent(new OrderConfirmed({
      orderId: this.id,
      customerId: this.customerId,
      totalAmount: this.totalAmount,
      occurredAt: new Date()
    }));
  }
  
  addDomainEvent(event) {
    this.domainEvents = this.domainEvents || [];
    this.domainEvents.push(event);
  }
  
  getDomainEvents() {
    return this.domainEvents || [];
  }
  
  clearDomainEvents() {
    this.domainEvents = [];
  }
}

// Application Service publishes events
class OrderApplicationService {
  async confirmOrder(orderId) {
    const order = await this.orderRepository.findById(orderId);
    
    order.confirm(); // Domain logic
    
    await this.orderRepository.save(order);
    
    // ✅ Publish domain events
    const events = order.getDomainEvents();
    for (const event of events) {
      await this.eventPublisher.publish(event);
    }
    
    order.clearDomainEvents();
  }
}
```

---

## 🔄 Microservices & DDD

### ❓ Q11: What's the relationship between bounded contexts and microservices?

**Answer**: 
- **Bounded Context** = logical boundary (design concept)
- **Microservice** = deployment unit (implementation concept)
- **General rule**: One bounded context per microservice
- **Exceptions**: Small contexts can be combined, large contexts can be split

```javascript
// ✅ Good: One bounded context per service
const serviceMapping = {
  'order-service': ['Order Management Context'],
  'inventory-service': ['Inventory Management Context'],
  'catalog-service': ['Product Catalog Context'],
  'customer-service': ['Customer Management Context']
};

// ⚠️ Acceptable: Small contexts combined
const combinedService = {
  'customer-service': [
    'Customer Management Context',
    'Customer Preferences Context', // Small, tightly related
    'Customer Analytics Context'    // Small, same team
  ]
};

// ❌ Avoid: Multiple unrelated contexts in one service
const badService = {
  'business-service': [
    'Order Management Context',
    'Inventory Management Context', // Different business concerns
    'Payment Processing Context'    // Different team ownership
  ]
};
```

### ❓ Q12: How do you handle distributed transactions in DDD microservices?

**Answer**: Use the **Saga Pattern** instead of distributed transactions.

```javascript
// ❌ Distributed transaction (avoid)
async function placeOrder(orderData) {
  const transaction = await distributedTransaction.begin();
  
  try {
    await orderService.createOrder(orderData, transaction);
    await inventoryService.reserveStock(orderData.items, transaction);
    await paymentService.chargePayment(orderData.payment, transaction);
    
    await transaction.commit(); // ❌ Two-phase commit across services
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

// ✅ Saga Pattern (choreography)
class OrderSaga {
  async handle(orderCreatedEvent) {
    try {
      // Step 1: Reserve inventory
      await this.inventoryService.reserveStock(orderCreatedEvent.items);
      
      // Step 2: Process payment  
      await this.paymentService.processPayment(orderCreatedEvent.payment);
      
      // Step 3: Confirm order
      await this.orderService.confirmOrder(orderCreatedEvent.orderId);
      
    } catch (error) {
      // Compensating actions
      await this.compensate(orderCreatedEvent.orderId);
    }
  }
  
  async compensate(orderId) {
    // Reverse operations in order
    await this.paymentService.refund(orderId);
    await this.inventoryService.releaseReservation(orderId);
    await this.orderService.cancelOrder(orderId);
  }
}
```

### ❓ Q13: How do you implement CQRS with DDD?

**Answer**: Separate read and write models, optimizing each for its purpose.

```javascript
// Command Side (Write Model) - DDD Aggregates
class OrderCommandHandler {
  constructor(orderRepository, eventBus) {
    this.orderRepository = orderRepository;
    this.eventBus = eventBus;
  }
  
  async handle(createOrderCommand) {
    // Rich domain model for writes
    const order = Order.create(
      createOrderCommand.customerId,
      createOrderCommand.items
    );
    
    await this.orderRepository.save(order);
    
    // Publish events for read model updates
    const events = order.getDomainEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }
  }
}

// Query Side (Read Model) - Optimized for reads
class OrderQueryHandler {
  constructor(readModelRepository) {
    this.readModelRepository = readModelRepository;
  }
  
  async getCustomerOrders(customerId) {
    // Denormalized, optimized for reading
    return await this.readModelRepository.findOrdersByCustomer(customerId);
  }
  
  async getOrderSummary(orderId) {
    // Pre-calculated aggregations
    return await this.readModelRepository.getOrderSummary(orderId);
  }
}

// Event Handler updates read models
class OrderProjection {
  async handleOrderCreated(event) {
    const orderView = {
      orderId: event.orderId,
      customerId: event.customerId,
      status: 'PENDING',
      totalAmount: event.totalAmount,
      itemCount: event.items.length,
      createdAt: event.occurredAt
    };
    
    await this.readModelRepository.saveOrderView(orderView);
  }
}
```

---

## 🚫 Common Mistakes & Pitfalls

### ❓ Q14: What are the most common DDD mistakes?

**Answer**:

#### 1. **Anemic Domain Models**
```javascript
// ❌ All logic in services
class OrderService {
  calculateTotal(order) {
    return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }
  
  validateOrder(order) {
    if (order.items.length === 0) throw new Error('Empty order');
  }
}

// ✅ Logic in domain
class Order {
  calculateTotal() {
    return this.items.reduce((sum, item) => sum.add(item.getSubtotal()), Money.zero());
  }
  
  validate() {
    if (this.items.length === 0) {
      throw new DomainError('Cannot create empty order');
    }
  }
}
```

#### 2. **Oversized Aggregates**
```javascript
// ❌ Too large, performance issues
class Customer {
  constructor() {
    this.orders = []; // ❌ Don't include other aggregates
    this.payments = []; // ❌ Separate aggregate
    this.shipments = []; // ❌ Separate aggregate
  }
}

// ✅ Right-sized aggregates
class Customer {
  constructor() {
    this.addresses = []; // ✅ Value objects within boundary
    this.preferences = new CustomerPreferences(); // ✅ Entity within boundary
  }
}

class Order {
  constructor(customerId) {
    this.customerId = customerId; // ✅ Reference by ID
    this.lineItems = []; // ✅ Entities within boundary
  }
}
```

#### 3. **Technical-Driven Contexts**
```javascript
// ❌ Technical boundaries
const contexts = [
  'UserCRUD',
  'ProductCRUD',
  'OrderCRUD'
];

// ✅ Business boundaries
const contexts = [
  'Customer Management',
  'Product Catalog',
  'Order Processing',
  'Inventory Management'
];
```

### ❓ Q15: How do you avoid over-engineering with DDD?

**Answer**: Start simple and evolve:

```javascript
// Phase 1: Start simple
class Order {
  constructor(customerId, items) {
    this.id = generateId();
    this.customerId = customerId;
    this.items = items;
    this.status = 'PENDING';
  }
  
  confirm() {
    this.status = 'CONFIRMED';
  }
}

// Phase 2: Add complexity as needed
class Order {
  constructor(customerId, items) {
    this.id = generateId();
    this.customerId = customerId;
    this.items = items;
    this.status = OrderStatus.PENDING;
    this.domainEvents = [];
  }
  
  confirm() {
    if (this.items.length === 0) {
      throw new DomainError('Cannot confirm empty order');
    }
    
    this.status = OrderStatus.CONFIRMED;
    this.addDomainEvent(new OrderConfirmed(this.id));
  }
  
  // Add more complexity incrementally...
}

// Guidelines:
// 1. Start with simple entities
// 2. Add value objects when you see primitive obsession
// 3. Add domain events when you need integration
// 4. Add aggregates when you need consistency boundaries
// 5. Add domain services when logic spans aggregates
```

---

## 🏢 Real-World Implementation

### ❓ Q16: How do you introduce DDD to an existing legacy system?

**Answer**: Use the **Strangler Fig Pattern**:

```javascript
// Phase 1: Create anticorruption layer
class LegacyOrderAdapter {
  constructor(legacyOrderSystem) {
    this.legacySystem = legacyOrderSystem;
  }
  
  async getOrder(orderId) {
    const legacyOrder = await this.legacySystem.getOrder(orderId);
    
    // Translate to domain model
    return new Order(
      legacyOrder.order_id,
      legacyOrder.customer_id,
      legacyOrder.items.map(item => new OrderItem(item.product_id, item.qty))
    );
  }
}

// Phase 2: Implement new features with DDD
class NewOrderService {
  async processAdvancedOrder(orderData) {
    // New functionality uses DDD
    const order = Order.create(orderData);
    order.applyAdvancedPricing();
    return await this.orderRepository.save(order);
  }
}

// Phase 3: Gradually migrate existing features
class HybridOrderService {
  async getOrder(orderId) {
    if (this.featureFlag.isEnabled('NEW_ORDER_SERVICE', orderId)) {
      return await this.newOrderService.getOrder(orderId);
    } else {
      return await this.legacyOrderAdapter.getOrder(orderId);
    }
  }
}
```

### ❓ Q17: How do you handle performance in DDD applications?

**Answer**: Use multiple strategies:

```javascript
// 1. CQRS for read optimization
class OrderQueryService {
  async getCustomerOrderHistory(customerId) {
    // Optimized read model
    return await this.readModelRepository.findOrdersByCustomer(customerId);
  }
}

// 2. Aggregate caching
class CachedOrderRepository {
  async findById(orderId) {
    // Check cache first
    let order = await this.cache.get(`order:${orderId}`);
    
    if (!order) {
      order = await this.database.findById(orderId);
      await this.cache.set(`order:${orderId}`, order, 300); // 5 min TTL
    }
    
    return order;
  }
}

// 3. Event sourcing snapshots
class SnapshotRepository {
  async getOrderSnapshot(orderId) {
    const snapshot = await this.findLatestSnapshot(orderId);
    
    if (snapshot) {
      const eventsAfterSnapshot = await this.eventStore.getEventsAfter(
        orderId, 
        snapshot.version
      );
      
      const order = Order.fromSnapshot(snapshot);
      eventsAfterSnapshot.forEach(event => order.apply(event));
      
      return order;
    }
    
    // No snapshot, rebuild from all events
    const events = await this.eventStore.getAllEvents(orderId);
    return Order.fromEvents(events);
  }
}

// 4. Lazy loading for aggregates
class Order {
  constructor(id, customerId) {
    this.id = id;
    this.customerId = customerId;
    this._lineItems = null; // Lazy-loaded
  }
  
  async getLineItems() {
    if (!this._lineItems) {
      this._lineItems = await this.lineItemRepository.findByOrderId(this.id);
    }
    return this._lineItems;
  }
}
```

### ❓ Q18: How do you test DDD applications?

**Answer**: Use different testing strategies for different layers:

```javascript
// 1. Unit tests for domain logic
describe('Order Domain Model', () => {
  test('should confirm order with valid items', () => {
    const order = new Order('customer-123');
    order.addItem('product-456', 2, new Money(29.99, 'USD'));
    
    order.confirm();
    
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(order.getDomainEvents()).toHaveLength(1);
    expect(order.getDomainEvents()[0]).toBeInstanceOf(OrderConfirmed);
  });
  
  test('should not confirm empty order', () => {
    const order = new Order('customer-123');
    
    expect(() => order.confirm()).toThrow('Cannot confirm empty order');
  });
});

// 2. Integration tests for repositories
describe('Order Repository', () => {
  test('should save and retrieve order', async () => {
    const order = Order.create('customer-123', [
      { productId: 'product-456', quantity: 2 }
    ]);
    
    await orderRepository.save(order);
    
    const retrievedOrder = await orderRepository.findById(order.id);
    
    expect(retrievedOrder.id).toBe(order.id);
    expect(retrievedOrder.customerId).toBe('customer-123');
    expect(retrievedOrder.lineItems).toHaveLength(1);
  });
});

// 3. Contract tests for service communication
describe('Inventory Service Contract', () => {
  test('should check availability correctly', async () => {
    const mock = nock('http://inventory-service')
      .get('/products/product-123/availability')
      .query({ quantity: 5 })
      .reply(200, { available: true, quantity: 10 });
    
    const availability = await inventoryService.checkAvailability('product-123', 5);
    
    expect(availability.available).toBe(true);
    expect(availability.quantity).toBe(10);
  });
});

// 4. End-to-end tests for business scenarios
describe('Order Processing Flow', () => {
  test('should complete full order flow', async () => {
    // Create customer
    const customer = await createTestCustomer();
    
    // Add products to catalog
    const product = await createTestProduct();
    
    // Set inventory
    await setProductInventory(product.id, 10);
    
    // Place order
    const orderResponse = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        items: [{ productId: product.id, quantity: 2 }]
      });
    
    expect(orderResponse.status).toBe(201);
    
    // Verify order created
    const order = await getOrder(orderResponse.body.orderId);
    expect(order.status).toBe('PENDING');
    
    // Verify inventory reserved
    const inventory = await getInventory(product.id);
    expect(inventory.reserved).toBe(2);
  });
});
```

---

## 💼 Interview Questions & Answers

### ❓ Q19: "Explain the difference between DDD and Clean Architecture"

**Answer**: 
- **DDD**: Domain modeling methodology focused on business knowledge
- **Clean Architecture**: Application structure pattern focused on dependency management

```javascript
// DDD focuses on domain modeling
class Order {
  // Rich business behavior
  calculateDiscountedTotal(customer) {
    let total = this.baseTotal;
    
    if (customer.isVIP()) {
      total = total.multiply(0.9); // 10% VIP discount
    }
    
    if (this.isLargeOrder()) {
      total = total.multiply(0.95); // 5% bulk discount
    }
    
    return total;
  }
}

// Clean Architecture focuses on layer isolation
class OrderController {
  constructor(orderUseCase) { // Dependency injection
    this.orderUseCase = orderUseCase; // Application layer
  }
  
  async createOrder(req, res) {
    try {
      const result = await this.orderUseCase.createOrder(req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

// They complement each other:
// - DDD provides domain modeling techniques
// - Clean Architecture provides application structure
// - Together: Rich domain models with proper dependency management
```

### ❓ Q20: "How would you design an e-commerce system using DDD?"

**Answer**: Break down by bounded contexts:

```javascript
// 1. Identify Bounded Contexts
const boundedContexts = {
  'Product Catalog': {
    aggregates: ['Product', 'Category'],
    responsibilities: ['Product information', 'Search', 'Categorization']
  },
  
  'Shopping Cart': {
    aggregates: ['Cart'],
    responsibilities: ['Add/remove items', 'Calculate totals']
  },
  
  'Order Management': {
    aggregates: ['Order'],
    responsibilities: ['Order processing', 'Order tracking', 'Order history']
  },
  
  'Inventory': {
    aggregates: ['ProductStock'],
    responsibilities: ['Stock levels', 'Reservations', 'Replenishment']
  },
  
  'Payment': {
    aggregates: ['Payment'],
    responsibilities: ['Payment processing', 'Refunds', 'Payment methods']
  }
};

// 2. Define Key Aggregates
class Order {
  static create(customerId, shippingAddress) {
    const order = new Order(generateId(), customerId);
    order.setShippingAddress(shippingAddress);
    order.addDomainEvent(new OrderCreated(order.id, customerId));
    return order;
  }
  
  addLineItem(productId, quantity, unitPrice) {
    if (this.status !== OrderStatus.DRAFT) {
      throw new DomainError('Cannot modify confirmed order');
    }
    
    const lineItem = new OrderLineItem(productId, quantity, unitPrice);
    this.lineItems.push(lineItem);
    this.recalculateTotal();
  }
  
  submit() {
    if (this.lineItems.length === 0) {
      throw new DomainError('Cannot submit empty order');
    }
    
    this.status = OrderStatus.SUBMITTED;
    this.addDomainEvent(new OrderSubmitted(this.id, this.lineItems));
  }
}

// 3. Define Domain Services
class OrderPricingService {
  calculateOrderTotal(order, customer, promotions) {
    let subtotal = order.getSubtotal();
    
    // Apply customer discounts
    const customerDiscount = this.calculateCustomerDiscount(customer, subtotal);
    subtotal = subtotal.subtract(customerDiscount);
    
    // Apply promotions
    const promotionDiscount = this.applyPromotions(promotions, order);
    subtotal = subtotal.subtract(promotionDiscount);
    
    // Calculate tax
    const tax = this.calculateTax(subtotal, order.shippingAddress);
    
    return subtotal.add(tax);
  }
}

// 4. Define Integration Events
class OrderSubmitted {
  constructor(orderId, lineItems) {
    this.orderId = orderId;
    this.lineItems = lineItems;
    this.occurredAt = new Date();
  }
}

// Other contexts listen to events
class InventoryEventHandler {
  async handleOrderSubmitted(event) {
    // Reserve inventory for order items
    for (const item of event.lineItems) {
      await this.inventoryService.reserveStock(
        item.productId, 
        item.quantity, 
        event.orderId
      );
    }
  }
}
```

### ❓ Q21: "How do you handle eventual consistency in DDD?"

**Answer**: Use domain events and saga patterns:

```javascript
// 1. Domain Events for eventual consistency
class Order {
  confirm() {
    this.status = OrderStatus.CONFIRMED;
    
    // Raise event - other contexts will eventually be consistent
    this.addDomainEvent(new OrderConfirmed({
      orderId: this.id,
      customerId: this.customerId,
      lineItems: this.lineItems
    }));
  }
}

// 2. Event handlers update other contexts
class InventoryEventHandler {
  async handleOrderConfirmed(event) {
    // Update inventory in separate transaction
    try {
      await this.inventoryService.confirmReservations(event.orderId);
    } catch (error) {
      // Handle failure - could retry or compensate
      await this.handleInventoryUpdateFailure(event, error);
    }
  }
}

// 3. Saga for complex workflows
class OrderFulfillmentSaga {
  async execute(orderConfirmedEvent) {
    const saga = new SagaInstance(orderConfirmedEvent.orderId);
    
    try {
      // Step 1: Confirm inventory
      await this.inventoryService.confirmReservation(orderConfirmedEvent.orderId);
      saga.recordStep('INVENTORY_CONFIRMED');
      
      // Step 2: Process payment
      await this.paymentService.capturePayment(orderConfirmedEvent.orderId);
      saga.recordStep('PAYMENT_CAPTURED');
      
      // Step 3: Initiate shipping
      await this.shippingService.createShipment(orderConfirmedEvent.orderId);
      saga.recordStep('SHIPMENT_CREATED');
      
      saga.complete();
      
    } catch (error) {
      // Compensate in reverse order
      await this.compensate(saga);
    }
  }
}

// 4. Read models for queries
class OrderProjection {
  async handleOrderConfirmed(event) {
    // Update denormalized read model
    await this.updateOrderView(event.orderId, {
      status: 'CONFIRMED',
      confirmedAt: new Date()
    });
  }
  
  async handleInventoryConfirmed(event) {
    await this.updateOrderView(event.orderId, {
      inventoryStatus: 'CONFIRMED'
    });
  }
}
```

### ❓ Q22: "What are the trade-offs of using DDD?"

**Answer**:

**Benefits:**
- Clear business logic modeling
- Better team communication
- Maintainable complex systems
- Flexibility and extensibility

**Costs:**
- Learning curve and complexity
- More code and abstraction
- Potential over-engineering
- Team alignment required

```javascript
// Trade-off Example: Simple vs DDD approach

// Simple approach (good for simple domains)
class OrderService {
  async createOrder(orderData) {
    const order = {
      id: generateId(),
      customerId: orderData.customerId,
      items: orderData.items,
      total: this.calculateTotal(orderData.items),
      status: 'PENDING'
    };
    
    return await this.database.save('orders', order);
  }
}

// DDD approach (good for complex domains)
class Order {
  static create(customerId, lineItems, shippingAddress) {
    const order = new Order(customerId);
    
    lineItems.forEach(item => {
      order.addLineItem(item.productId, item.quantity, item.unitPrice);
    });
    
    order.setShippingAddress(shippingAddress);
    order.validateBusinessRules();
    
    order.addDomainEvent(new OrderCreated(order.id, customerId));
    
    return order;
  }
  
  addLineItem(productId, quantity, unitPrice) {
    // Rich business logic
    if (this.status !== OrderStatus.DRAFT) {
      throw new DomainError('Cannot modify submitted order');
    }
    
    if (this.hasProductAlready(productId)) {
      this.updateExistingLineItem(productId, quantity);
    } else {
      this.lineItems.push(new OrderLineItem(productId, quantity, unitPrice));
    }
    
    this.recalculateTotal();
    this.validateOrderLimits();
  }
}

// Decision matrix:
const useSimpleApproach = {
  when: [
    'Simple business rules',
    'Small team',
    'Short-term project',
    'Well-understood domain'
  ]
};

const useDDDApproach = {
  when: [
    'Complex business logic',
    'Large team',
    'Long-term strategic system',
    'Domain expertise needed',
    'Multiple bounded contexts'
  ]
};
```

---

## 🎯 Advanced Topics

### ❓ Q23: "How do you implement Event Sourcing with DDD?"

**Answer**: Store domain events as the source of truth:

```javascript
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
  
  // Command methods create events
  static create(customerId, lineItems) {
    const order = new Order();
    const event = new OrderCreated(generateId(), customerId, lineItems);
    order.apply(event);
    order.markEventAsNew(event);
    return order;
  }
  
  addLineItem(productId, quantity, unitPrice) {
    if (this.status === OrderStatus.SHIPPED) {
      throw new DomainError('Cannot modify shipped order');
    }
    
    const event = new LineItemAdded(this.id, productId, quantity, unitPrice);
    this.apply(event);
    this.markEventAsNew(event);
  }
  
  // Apply events to change state
  apply(event) {
    switch (event.constructor.name) {
      case 'OrderCreated':
        this.id = event.orderId;
        this.customerId = event.customerId;
        this.status = OrderStatus.DRAFT;
        this.lineItems = event.lineItems.map(item => new OrderLineItem(item));
        break;
        
      case 'LineItemAdded':
        this.lineItems.push(new OrderLineItem(event));
        break;
        
      case 'OrderShipped':
        this.status = OrderStatus.SHIPPED;
        this.trackingNumber = event.trackingNumber;
        break;
    }
    
    this.version++;
  }
  
  // Rebuild from events
  static fromEvents(events) {
    const order = new Order();
    events.forEach(event => order.apply(event.data));
    return order;
  }
}

// Event Store
class EventStore {
  async saveEvents(streamId, events, expectedVersion) {
    // Optimistic concurrency check
    const currentVersion = await this.getCurrentVersion(streamId);
    if (currentVersion !== expectedVersion) {
      throw new ConcurrencyError('Version mismatch');
    }
    
    // Save events atomically
    await this.database.transaction(async (trx) => {
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
  
  async getEvents(streamId) {
    const rows = await this.database('events')
      .where('stream_id', streamId)
      .orderBy('version');
    
    return rows.map(row => ({
      version: row.version,
      eventType: row.event_type,
      data: JSON.parse(row.event_data),
      createdAt: row.created_at
    }));
  }
}
```

### ❓ Q24: "How do you handle schema evolution in Event Sourcing?"

**Answer**: Use event versioning and upcasting:

```javascript
// Event with version
class OrderCreated {
  constructor(orderId, customerId, lineItems, version = 1) {
    this.orderId = orderId;
    this.customerId = customerId;
    this.lineItems = lineItems;
    this.version = version;
  }
}

// Evolved event (v2)
class OrderCreatedV2 {
  constructor(orderId, customerId, lineItems, shippingAddress, version = 2) {
    this.orderId = orderId;
    this.customerId = customerId;
    this.lineItems = lineItems;
    this.shippingAddress = shippingAddress; // New field
    this.version = version;
  }
}

// Event upcaster
class EventUpcaster {
  upcast(event) {
    switch (event.eventType) {
      case 'OrderCreated':
        if (event.data.version === 1) {
          // Upcast v1 to v2
          return new OrderCreatedV2(
            event.data.orderId,
            event.data.customerId,
            event.data.lineItems,
            null, // Default shipping address for old events
            2
          );
        }
        break;
    }
    
    return event;
  }
}

// Repository with upcasting
class EventSourcedOrderRepository {
  async findById(orderId) {
    const events = await this.eventStore.getEvents(orderId);
    
    // Upcast events to latest version
    const upcastedEvents = events.map(event => this.upcaster.upcast(event));
    
    return Order.fromEvents(upcastedEvents);
  }
}
```

---

## ✅ Summary Checklist

After reading this FAQ, you should be able to:

### Core Concepts
- [ ] Explain when to use DDD vs simpler approaches
- [ ] Distinguish between domain model and data model
- [ ] Identify anemic domain models
- [ ] Design bounded contexts properly

### Strategic Design
- [ ] Identify different types of subdomains
- [ ] Choose appropriate context mapping patterns
- [ ] Handle communication between contexts

### Tactical Design  
- [ ] Design entities vs value objects correctly
- [ ] Create properly-sized aggregates
- [ ] Use domain services appropriately
- [ ] Implement domain events

### Microservices
- [ ] Map bounded contexts to services
- [ ] Handle distributed transactions with sagas
- [ ] Implement CQRS pattern
- [ ] Manage eventual consistency

### Real-World Application
- [ ] Introduce DDD to legacy systems
- [ ] Handle performance concerns
- [ ] Test DDD applications properly
- [ ] Avoid common pitfalls

### Advanced Topics
- [ ] Implement Event Sourcing
- [ ] Handle schema evolution
- [ ] Choose appropriate trade-offs

---

## 🎯 Next Steps
Complete your DDD journey with **Phase 7: Project Structure and Learning Plan** to see how to organize your learning and implementation over time!